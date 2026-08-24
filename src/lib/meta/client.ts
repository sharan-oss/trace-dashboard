/**
 * Thin typed client for the three Graph API endpoints this project reads.
 *
 * Hand-written rather than the official SDK, deliberately: this needs three
 * read-only endpoints and absolute control over which API version is called.
 * Meta sunsets versions on a schedule, so moving is an explicit act — which is
 * what Airbyte and Fivetran do for the same job.
 *
 * Account discovery is /me/assigned_ad_accounts: system-user tokens cannot
 * traverse /{business_id}/owned_ad_accounts (proven live 2026-08-10, error
 * "(#100) nonexisting field"). The assigned edge also carries each account's
 * OWNING business, which is how a partner-shared account is recognised.
 *
 * fetch and sleep are injectable so the whole retry and rate-limit path is
 * testable without a live call or a real delay.
 */
import { createHmac } from "node:crypto";
import { assertBudget } from "@/lib/meta/deadline";
import type {
  MetaAd,
  MetaAdAccount,
  MetaAdImage,
  MetaAdVideo,
  MetaInsightRow,
  MetaListResponse,
} from "@/lib/meta/types";

const GRAPH_HOST = "https://graph.facebook.com";
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const USAGE_THROTTLE_PERCENT = 80;
const USAGE_THROTTLE_MS = 2_000;
/** Meta's rate-limit error codes: 17 user request limit, 613 calls-per-hour,
 * 80004 the hourly ads_management business-use-case quota. */
const RATE_LIMIT_CODES = new Set([17, 613, 80004]);
/**
 * Meta's ad-account API-level score limiter, which has NO usage header — the
 * only way to respect it is to model it client-side.
 *
 * Documented: a read costs 1 point, a write 3. Development tier allows a max
 * score of 60 decaying over 300s, and blocks for 300s once reached; Full
 * access allows 9000 and blocks for 60s. This is the limiter that killed the
 * first Occultyogis backfill (code 17 / subcode 2446079) while x-app-usage and
 * x-ad-account-usage both read zero, because neither header covers it.
 * https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
 */
const DEV_TIER_MAX_SCORE = 60;
const SCORE_DECAY_MS = 300_000;
/** Meta's own instruction on hitting it: stop. Retrying sooner extends the
 * block — "Continuing to make calls will continue to increase your call
 * count, which will increase the time before calls will be successful again."
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting */
const BLOCKED_BACKOFF_MS = 300_000;
/** Code 1 "Please reduce the amount of data you're asking for" — the page is
 * too expensive to compute, not too frequent. Halving the page size fixes it;
 * backing off does not. */
const DATA_VOLUME_CODE = 1;
/** Below this a page is not worth requesting — treat it as a real failure. */
const MIN_PAGE_LIMIT = 10;

/** Halves a request URL's `limit`, or null once the floor is reached. */
function halveLimit(url: string): string | null {
  const parsed = new URL(url);
  const current = Number(parsed.searchParams.get("limit"));
  if (!Number.isFinite(current) || current <= MIN_PAGE_LIMIT) return null;
  const next = Math.max(MIN_PAGE_LIMIT, Math.floor(current / 2));
  parsed.searchParams.set("limit", String(next));
  return parsed.toString();
}

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly status: number;

  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

export type MetaClientOptions = {
  token: string;
  apiVersion: string;
  /** When set, every call carries appsecret_proof (HMAC-SHA256 of the token),
   * so a leaked token is useless without the app secret. */
  appSecret?: string;
  /** Called once per HTTP request (including pagination and retries) — the
   * sync uses it to record api_calls on the run log. */
  onRequest?: (url: string) => void;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Score budget per 300s window. Defaults to the development tier's 60.
   * Raise to 9000 once the app holds Full access to the Marketing API. */
  maxScore?: number;
  /** Epoch-ms invocation budget. Every sleep and every page walk checks it
   * first and throws DeadlineError rather than outliving the function — a
   * rate-limit block (300s) must never carry a run past Vercel's kill. */
  deadlineAt?: number;
};

export type MetaClient = {
  listAdAccounts(): Promise<MetaAdAccount[]>;
  /** Names and hierarchy only — no creative. See listAdCreatives.
   * `updatedSince` (unix seconds) returns only ads touched since then, which
   * is what keeps a repeat sync to a call or two instead of a full walk. */
  listAds(adAccountId: string, updatedSince?: number): Promise<MetaAd[]>;
  /** The account's image library, keyed by hash. Bulk, no per-row rendering. */
  listAdImages(adAccountId: string, hashes?: string[]): Promise<MetaAdImage[]>;
  /** The account's video library, keyed by video id. Bulk, no per-row rendering. */
  listAdVideos(adAccountId: string, videoIds?: string[]): Promise<MetaAdVideo[]>;
  /** One row per ad per day over [since, until], both inclusive YYYY-MM-DD. */
  getAdInsights(adAccountId: string, since: string, until: string): Promise<MetaInsightRow[]>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Meta's own estimate, in ms, of how long until a throttled bucket recovers.
 * Unlike the score limiter, the business-use-case buckets DO report this —
 * `estimated_time_to_regain_access` is in minutes. Waiting exactly as long as
 * Meta asks beats guessing in either direction.
 */
function regainAccessMs(header: string | null): number | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(header) as Record<
      string,
      Array<{ estimated_time_to_regain_access?: number }>
    >;
    let minutes = 0;
    for (const entries of Object.values(parsed)) {
      for (const entry of entries) {
        minutes = Math.max(minutes, entry.estimated_time_to_regain_access ?? 0);
      }
    }
    return minutes > 0 ? minutes * 60_000 : null;
  } catch {
    return null;
  }
}

/** Highest call_count percentage across every bucket in the usage header. */
function peakUsagePercent(header: string | null): number {
  if (!header) return 0;
  try {
    const parsed = JSON.parse(header) as Record<
      string,
      Array<{ call_count?: number; total_cputime?: number; total_time?: number }>
    >;
    let peak = 0;
    for (const entries of Object.values(parsed)) {
      for (const entry of entries) {
        peak = Math.max(
          peak,
          entry.call_count ?? 0,
          entry.total_cputime ?? 0,
          entry.total_time ?? 0
        );
      }
    }
    return peak;
  } catch {
    return 0;
  }
}

export function createMetaClient(options: MetaClientOptions): MetaClient {
  const { token, apiVersion, appSecret } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const rawSleep = options.sleepImpl ?? defaultSleep;
  const maxScore = options.maxScore ?? DEV_TIER_MAX_SCORE;
  const deadlineAt = options.deadlineAt;

  // Every sleep in this client goes through here: refuse to start one the
  // budget cannot absorb, so the process is never asleep when Vercel kills it.
  const sleep = async (ms: number) => {
    assertBudget(deadlineAt, ms);
    await rawSleep(ms);
  };

  // Leaky-bucket model of the score limiter: `spent` decays linearly at
  // maxScore per SCORE_DECAY_MS. Paced BEFORE each call, so we wait rather
  // than earn a 300s block — a request never sent cannot be throttled.
  let spent = 0;
  let lastDecayAt = 0;

  async function reserveScore(cost: number, nowMs: number): Promise<void> {
    if (lastDecayAt === 0) lastDecayAt = nowMs;
    spent = Math.max(0, spent - ((nowMs - lastDecayAt) / SCORE_DECAY_MS) * maxScore);
    lastDecayAt = nowMs;

    if (spent + cost > maxScore) {
      const overBy = spent + cost - maxScore;
      await sleep(Math.ceil((overBy / maxScore) * SCORE_DECAY_MS));
      spent = Math.max(0, spent - overBy);
    }
    spent += cost;
  }
  const proof = appSecret
    ? createHmac("sha256", appSecret).update(token).digest("hex")
    : undefined;

  async function requestOnce(url: string): Promise<{ body: unknown; response: Response }> {
    await reserveScore(1, Date.now());
    options.onRequest?.(url);
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    return { body, response };
  }

  /** One request with retry on rate-limit errors, and throttling on high usage. */
  async function request<T>(url: string): Promise<T> {
    let attempt = 0;

    for (;;) {
      const { body, response } = await requestOnce(url);
      const error = (body as { error?: { message?: string; code?: number; error_subcode?: number } })
        .error;

      if (error) {
        const retryable = RATE_LIMIT_CODES.has(error.code ?? -1);
        if (retryable && attempt < MAX_RETRIES) {
          // A score block is a documented fixed duration, not congestion:
          // exponential backoff from 500ms just burns retries inside it. Wait
          // the whole block once, and assume the bucket is drained after.
          const blocked = error.error_subcode === 2446079 || error.error_subcode === 1487742;
          const advertised = regainAccessMs(response.headers.get("x-business-use-case-usage"));
          await sleep(
            advertised ?? (blocked ? BLOCKED_BACKOFF_MS : BASE_BACKOFF_MS * 2 ** attempt)
          );
          if (blocked) {
            spent = 0;
            lastDecayAt = Date.now();
          }
          attempt += 1;
          continue;
        }
        throw new MetaApiError(
          error.message ?? "Meta API request failed",
          response.status,
          error.code,
          error.error_subcode
        );
      }

      if (peakUsagePercent(response.headers.get("x-business-use-case-usage")) >= USAGE_THROTTLE_PERCENT) {
        await sleep(USAGE_THROTTLE_MS);
      }

      return body as T;
    }
  }

  /**
   * Follows paging.next until exhausted. Never assume one page.
   *
   * On code 1 the page size is halved and the SAME page retried, down to
   * MIN_PAGE_LIMIT. Meta's ceiling is per-account and not knowable up front:
   * the 720px creative expansion on /ads returns fine at limit=100 for a
   * 1,130-ad account and is refused at both 100 and 50 for a 2,540-ad one
   * (measured live 2026-08-17). Meta echoes the reduced limit into its own
   * paging.next, so one halving carries through the rest of the walk.
   */
  async function requestAll<T>(firstUrl: string, maxPages = Infinity): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = firstUrl;
    let pages = 0;

    while (next != null && pages < maxPages) {
      // An account's walk has no page bound; the budget is the bound.
      assertBudget(deadlineAt);
      pages += 1;
      let url: string = next;
      let page: MetaListResponse<T> | undefined;

      while (page === undefined) {
        try {
          page = await request<MetaListResponse<T>>(url);
        } catch (error) {
          if (!(error instanceof MetaApiError) || error.code !== DATA_VOLUME_CODE) throw error;
          const smaller = halveLimit(url);
          if (smaller == null) throw error;
          url = smaller;
        }
      }

      results.push(...(page.data ?? []));
      next = page.paging?.next;
    }

    return results;
  }

  function endpoint(path: string, params: Record<string, string>): string {
    const url = new URL(`${GRAPH_HOST}/${apiVersion}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    if (proof) url.searchParams.set("appsecret_proof", proof);
    return url.toString();
  }

  return {
    async listAdAccounts() {
      return requestAll<MetaAdAccount>(
        endpoint("me/assigned_ad_accounts", {
          fields:
            "id,account_id,name,currency,timezone_name,account_status,business{id,name}",
          limit: "100",
        })
      );
    },

    async listAds(adAccountId, updatedSince) {
      return requestAll<MetaAd>(
        endpoint(`${adAccountId}/ads`, {
          // Meta's own incremental parameter on this edge. A 2,540-ad account
          // costs ~6 calls to walk cold and ~1 when nothing changed, which is
          // the difference between fitting the dev tier's 60-point budget and
          // exhausting it before the spend data is ever fetched.
          ...(updatedSince != null ? { updated_since: String(updatedSince) } : {}),
          // NO creative expansion here, deliberately. Asking for the 720px
          // creative inline makes each row so expensive that Meta refuses the
          // page: a 2,540-ad account was rejected at limit=100 AND 50 and only
          // answered at 25, turning one dimension walk into 102 calls, which
          // then tripped the user-level request limit (code 17) and lost the
          // whole run. Names and hierarchy are cheap, so this edge stays cheap
          // and creatives are fetched separately in a bounded pass —
          // ~6 calls per walk instead of ~102.
          // creative{} carries NO rendered field. thumbnail_width/height are
          // documented as "Rendered", i.e. a cold image resize per row, and
          // that is what collapses page size to 25 on a large account. Hashes
          // and ids are plain stored JSON, so they ride along for free — and
          // they are scattered, hence all three nests.
          fields:
            "id,name,adset{id,name},campaign{id,name},status,effective_status," +
            "creative{id,image_hash,video_id,image_url," +
            "object_story_spec{video_data{image_hash,image_url,video_id},link_data{image_hash,picture},photo_data{image_hash}}," +
            "asset_feed_spec{images{hash,url},videos{video_id,thumbnail_url,thumbnail_hash}}}",
          // Include paused and archived ads, so a historical name match still
          // resolves after an ad is retired. DELETED is deliberately absent:
          // Meta refuses it on this edge (code 100 subcode 1815001, "Cannot
          // request deleted objects" — hit live 2026-08-10).
          effective_status: JSON.stringify([
            "ACTIVE",
            "PAUSED",
            "ARCHIVED",
            "CAMPAIGN_PAUSED",
            "ADSET_PAUSED",
          ]),
          limit: "500",
        })
      );
    },

    async listAdImages(adAccountId, hashes) {
      // `hashes` is an edge FILTER, not the ?ids= node form — Meta counts
      // ?ids= as one call per id, but a filtered edge read is a single call.
      return requestAll<MetaAdImage>(
        endpoint(`${adAccountId}/adimages`, {
          fields: "hash,permalink_url,url,width,height",
          ...(hashes?.length ? { hashes: JSON.stringify(hashes) } : {}),
          limit: "500",
        })
      );
    },

    async listAdVideos(adAccountId, videoIds) {
      // Same trick via `filtering` with the IN operator: one edge read for a
      // set of ids. `format` returns a size ladder per video, so we can pick a
      // card-sized rung without asking Meta to render anything.
      return requestAll<MetaAdVideo>(
        endpoint(`${adAccountId}/advideos`, {
          fields: "id,picture,thumbnails{uri,width,is_preferred},format{picture,width,height}",
          ...(videoIds?.length
            ? {
                filtering: JSON.stringify([
                  { field: "id", operator: "IN", value: videoIds },
                ]),
              }
            : {}),
          limit: "100",
        })
      );
    },

    async getAdInsights(adAccountId, since, until) {
      return requestAll<MetaInsightRow>(
        endpoint(`${adAccountId}/insights`, {
          level: "ad",
          time_increment: "1",
          fields:
            "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,reach",
          time_range: JSON.stringify({ since, until }),
          limit: "500",
        })
      );
    },
  };
}

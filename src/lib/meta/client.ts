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
import type {
  MetaAd,
  MetaAdAccount,
  MetaInsightRow,
  MetaListResponse,
} from "@/lib/meta/types";

const GRAPH_HOST = "https://graph.facebook.com";
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const USAGE_THROTTLE_PERCENT = 80;
const USAGE_THROTTLE_MS = 2_000;
/** Meta's rate-limit error codes: 17 user request limit, 613 calls-per-hour. */
const RATE_LIMIT_CODES = new Set([17, 613]);

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
};

export type MetaClient = {
  listAdAccounts(): Promise<MetaAdAccount[]>;
  listAds(adAccountId: string): Promise<MetaAd[]>;
  /** One row per ad per day over [since, until], both inclusive YYYY-MM-DD. */
  getAdInsights(adAccountId: string, since: string, until: string): Promise<MetaInsightRow[]>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const sleep = options.sleepImpl ?? defaultSleep;
  const proof = appSecret
    ? createHmac("sha256", appSecret).update(token).digest("hex")
    : undefined;

  async function requestOnce(url: string): Promise<{ body: unknown; response: Response }> {
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
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
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

  /** Follows paging.next until exhausted. Never assume one page. */
  async function requestAll<T>(firstUrl: string): Promise<T[]> {
    const results: T[] = [];
    let url: string | undefined = firstUrl;

    while (url) {
      const page: MetaListResponse<T> = await request<MetaListResponse<T>>(url);
      results.push(...(page.data ?? []));
      url = page.paging?.next;
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

    async listAds(adAccountId) {
      return requestAll<MetaAd>(
        endpoint(`${adAccountId}/ads`, {
          fields:
            "id,name,adset{id,name},campaign{id,name},status,effective_status,creative{id,thumbnail_url,image_url,image_hash}",
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
          limit: "100",
        })
      );
    },

    async getAdInsights(adAccountId, since, until) {
      return requestAll<MetaInsightRow>(
        endpoint(`${adAccountId}/insights`, {
          level: "ad",
          time_increment: "1",
          fields: "ad_id,spend,impressions,clicks,reach",
          time_range: JSON.stringify({ since, until }),
          limit: "500",
        })
      );
    },
  };
}

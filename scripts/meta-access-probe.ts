/**
 * Meta access probe — read-only diagnostic against the Graph API.
 *
 * Answers one question empirically: can a dev-mode Business app's System User
 * token read partner-shared client ad accounts at Standard Access (no App
 * Review)? docs/STATUS.md currently claims it cannot; 2026-08-10 research
 * says it can. Whichever way this run comes out decides Slice B's sequencing.
 *
 * Run: npx tsx scripts/meta-access-probe.ts
 *
 * Reads META_SYSTEM_USER_TOKEN, META_APP_SECRET, META_BUSINESS_ID and
 * META_API_VERSION from .env.local. Never touches Supabase, never writes
 * anywhere, never prints more than the last 4 characters of the token.
 */
import { createHmac } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const GRAPH_ORIGIN = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v26.0";

interface Env {
  token: string;
  appSecret: string;
  /** Optional: system-user tokens can't traverse business edges anyway. */
  businessId: string | undefined;
  apiVersion: string;
}

/** Meta's error envelope: { error: { message, type, code, error_subcode? } } */
interface MetaErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

class MetaRequestError extends Error {
  constructor(
    readonly status: number,
    readonly meta: MetaErrorBody,
  ) {
    super(
      `HTTP ${status} — code ${meta.code ?? "?"}` +
        (meta.error_subcode ? `/${meta.error_subcode}` : "") +
        ` (${meta.type ?? "unknown"}): ${meta.message ?? "no message"}`,
    );
  }
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  console.log(`\n${passed ? "✅ PASS" : "❌ FAIL"} — ${name}`);
  console.log(detail.replace(/^/gm, "   "));
}

function redact(token: string): string {
  return `…${token.slice(-4)}`;
}

function readEnv(): Env {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const appSecret = process.env.META_APP_SECRET;
  const businessId = process.env.META_BUSINESS_ID || undefined;
  let apiVersion = process.env.META_API_VERSION;
  const missing = [
    !token && "META_SYSTEM_USER_TOKEN",
    !appSecret && "META_APP_SECRET",
  ].filter(Boolean);
  if (missing.length > 0 || !token || !appSecret) {
    console.error(`Missing in .env.local: ${missing.join(", ")}`);
    process.exit(2);
  }
  if (!apiVersion) {
    console.warn(`META_API_VERSION unset — defaulting to ${DEFAULT_API_VERSION}`);
    apiVersion = DEFAULT_API_VERSION;
  }
  return { token, appSecret, businessId, apiVersion };
}

/**
 * The rate-limit headers are the only observability Meta gives; print them on
 * every response so the run records the granted tier (ads_api_access_tier).
 */
function printUsageHeaders(headers: Headers): void {
  for (const name of [
    "x-business-use-case-usage",
    "x-ad-account-usage",
    "x-fb-ads-insights-throttle",
  ]) {
    const raw = headers.get(name);
    if (raw) console.log(`   ${name}: ${raw}`);
  }
}

async function graphGet(
  env: Env,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${GRAPH_ORIGIN}/${env.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // appsecret_proof makes a leaked token useless without the app secret.
  url.searchParams.set(
    "appsecret_proof",
    createHmac("sha256", env.appSecret).update(env.token).digest("hex"),
  );
  const res = await fetch(url, {
    // Bearer header only — the token never goes in the query string.
    headers: { Authorization: `Bearer ${env.token}` },
  });
  printUsageHeaders(res.headers);
  const body = (await res.json().catch(() => ({}))) as {
    error?: MetaErrorBody;
  };
  if (!res.ok || body.error) {
    throw new MetaRequestError(res.status, body.error ?? {});
  }
  return body;
}

interface AdAccount {
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  /** The business that OWNS the account — a client's BM proves cross-business read. */
  business?: { id: string; name?: string };
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log(`Meta access probe — ${env.apiVersion}, token ${redact(env.token)}`);
  console.log(`Business ID: ${env.businessId}`);

  // Check 1 — token is alive, and what it actually carries.
  let identityOk = false;
  try {
    const me = (await graphGet(env, "me", { fields: "id,name" })) as {
      id?: string;
      name?: string;
    };
    identityOk = true;
    let detail = `Token authenticates as: ${me.name ?? "?"} (id ${me.id ?? "?"})`;
    try {
      const dbg = (await graphGet(env, "debug_token", {
        input_token: env.token,
      })) as {
        data?: { scopes?: string[]; expires_at?: number; type?: string };
      };
      const scopes = dbg.data?.scopes ?? [];
      const expiresAt = dbg.data?.expires_at;
      detail +=
        `\nScopes: ${scopes.join(", ") || "(none reported)"}` +
        `\nExpiry: ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "never (0)"}` +
        (scopes.includes("ads_read") ? "" : "\n⚠️  ads_read NOT in scopes — regenerate the token with it checked");
    } catch (err) {
      detail += `\n(debug_token introspection unavailable: ${(err as Error).message} — not fatal)`;
    }
    record("Token introspection (/me + /debug_token)", true, detail);
  } catch (err) {
    record("Token introspection (/me + /debug_token)", false, (err as Error).message);
  }
  if (!identityOk) {
    // Nothing downstream can mean anything with a dead token.
    finish();
    return;
  }

  // Check 2 — account discovery. System-user tokens can't traverse business
  // edges (/{business}/owned_ad_accounts etc.), so the canonical listing is
  // /me/assigned_ad_accounts. Each account's owning business is the crux: an
  // owner that is NOT our BM is exactly the partner-shared "other people's ad
  // account" STATUS.md says needs App Review.
  let accounts: AdAccount[] = [];
  try {
    const body = (await graphGet(env, "me/assigned_ad_accounts", {
      fields: "id,name,currency,timezone_name,account_status,business{id,name}",
      limit: "50",
    })) as { data?: AdAccount[] };
    accounts = body.data ?? [];
    const describe = (a: AdAccount) =>
      `${a.id} — ${a.name ?? "?"} (${a.currency ?? "?"}, ${a.timezone_name ?? "?"}, status ${a.account_status ?? "?"}) owned by ${a.business?.name ?? "?"} (${a.business?.id ?? "?"})`;
    record(
      "Account discovery (me/assigned_ad_accounts)",
      accounts.length > 0,
      `Assigned (${accounts.length}):\n${accounts.map(describe).join("\n") || "  none"}` +
        (accounts.length === 0
          ? "\n⚠️  No accounts assigned — assign them to the System User in Business Settings first."
          : ""),
    );
  } catch (err) {
    record("Account discovery (me/assigned_ad_accounts)", false, (err as Error).message);
  }

  // Prefer an account owned by a business other than ours (when META_BUSINESS_ID
  // is set) — reading one of those is the whole test.
  const shared = env.businessId
    ? accounts.filter((a) => a.business && a.business.id !== env.businessId)
    : accounts.filter((a) => a.business); // owner known ⇒ we can name whose it is
  const target = shared[0] ?? accounts[0];
  if (!target) {
    record(
      "Dimension read (/ads)",
      false,
      "No ad account reachable to test against — fix account discovery first.",
    );
    finish();
    return;
  }
  console.log(
    `\nTarget account for checks 3–4: ${target.id} (${target.name ?? "?"}) — owned by ${target.business?.name ?? "unknown business"}` +
      (env.businessId && target.business
        ? target.business.id === env.businessId
          ? " (OUR business — not the cross-business case!)"
          : " (client's business — the cross-business case)"
        : ""),
  );

  // Check 3 — the nested-hierarchy dimension fetch Slice B's sync will use.
  try {
    const body = (await graphGet(env, `${target.id}/ads`, {
      fields:
        "id,name,status,effective_status,adset{id,name},campaign{id,name},creative{id,thumbnail_url,image_hash}",
      limit: "10",
    })) as {
      data?: Array<{
        id: string;
        name?: string;
        effective_status?: string;
        campaign?: { name?: string };
        creative?: { thumbnail_url?: string; image_hash?: string };
      }>;
    };
    const ads = body.data ?? [];
    const sample = ads
      .slice(0, 5)
      .map(
        (a) =>
          `${a.id} — ${a.name ?? "?"} [${a.effective_status ?? "?"}] campaign="${a.campaign?.name ?? "?"}" thumb=${a.creative?.thumbnail_url ? "yes" : "no"} hash=${a.creative?.image_hash ?? "none"}`,
      )
      .join("\n");
    record(
      "Dimension read (/ads with nested adset/campaign/creative)",
      true,
      `${ads.length} ads returned (first page). Eyeball these ids against the 67 seeded Love School meta_ad_ids:\n${sample || "  (account has no ads)"}`,
    );
  } catch (err) {
    record("Dimension read (/ads with nested adset/campaign/creative)", false, (err as Error).message);
  }

  // Check 4 — daily-grain spend, the ad_insights_daily shape.
  try {
    const body = (await graphGet(env, `${target.id}/insights`, {
      level: "ad",
      time_increment: "1",
      fields: "ad_id,spend,impressions,clicks,date_start",
      date_preset: "last_7d",
      limit: "100",
    })) as {
      data?: Array<{ ad_id?: string; spend?: string; impressions?: string; date_start?: string }>;
    };
    const rows = body.data ?? [];
    const sample = rows
      .slice(0, 5)
      .map((r) => `${r.date_start} ad ${r.ad_id}: spend=${r.spend} impressions=${r.impressions}`)
      .join("\n");
    record(
      "Insights read (level=ad, time_increment=1, last_7d)",
      true,
      `${rows.length} ad-day rows returned.\n${sample || "  (no spend in the last 7 days — an empty result is still a PASS: the read was permitted)"}`,
    );
  } catch (err) {
    record("Insights read (level=ad, time_increment=1, last_7d)", false, (err as Error).message);
  }

  // Check 5 is not a request of its own — the tier arrives in the usage
  // headers printed above (ads_api_access_tier inside x-ad-account-usage /
  // x-business-use-case-usage). Summarize what to look for.
  record(
    "Tier + limits report",
    true,
    'Recorded from headers above — look for "ads_api_access_tier" (expected: development_access). ' +
      "If headers were absent on every call, note that too: absence at this volume is normal.",
  );

  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Summary: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((f) => f.name).join("; ")}`);
    console.log(
      "If checks 3–4 failed with code 200/10 on a partner-shared account, STATUS.md's App Review claim is CONFIRMED.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      "All checks passed on a partner-shared account ⇒ STATUS.md:56 is disproven — Slice B is unblocked at Standard Access.",
    );
  }
}

main().catch((err: unknown) => {
  console.error("Probe crashed unexpectedly:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

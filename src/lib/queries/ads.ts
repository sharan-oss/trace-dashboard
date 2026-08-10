import type { SupabaseClient } from "@supabase/supabase-js";
import { rangeToDays, type RangePreset } from "@/lib/range";

/**
 * Ads-section read layer (Slice D). Every aggregate is computed in Postgres by
 * the RPCs in migration 20260810150000 — raw rows are never paged into JS to
 * be summed. RLS is the tenant guarantee; p_client_id is defense-in-depth.
 */

export type AdsTier = "campaign" | "adset" | "ad";

export type AdsBreakdownRow = {
  tier: AdsTier;
  /** Null keys are the per-level Unattributed buckets — rendered, never dropped. */
  campaign_key: string | null;
  adset_key: string | null;
  ad_key: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  spend_paise: number;
  l1_revenue_paise: number;
  l1_paid_count: number;
  l2_revenue_paise: number;
  l2_count: number;
  sessions_count: number;
  name_matched: boolean;
  has_test: boolean;
  campaign_tier_only_revenue_paise: number;
};

export type AdsSummary = {
  spend_paise: number;
  spend_untracked_paise: number;
  unattributed_l1_revenue_paise: number;
  unattributed_l1_count: number;
};

export type SpendDailyRow = {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  spend_paise: number;
  l1_paid_count: number;
};

export type AdAccountSyncStatus = {
  id: string;
  name: string;
  meta_ad_account_id: string;
  status: string;
  /** Newest finished run's timestamps/status; null = never completed a run. */
  last_finished_at: string | null;
  last_run_status: string | null;
  /** A run row currently in 'running' state — "sync in progress", distinct from stale. */
  running_now: boolean;
};

export type AdThumbnail = {
  meta_ad_id: string;
  creative_thumbnail_path: string | null;
  status: string;
};

async function rpcRows<T>(
  supabase: SupabaseClient,
  fn: string,
  clientId: string,
  preset: RangePreset,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
  });
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? []) as T[];
}

export async function getAdsBreakdown(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<AdsBreakdownRow[]> {
  return rpcRows<AdsBreakdownRow>(supabase, "ads_breakdown", clientId, preset);
}

export async function getAdsSummary(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<AdsSummary> {
  const rows = await rpcRows<AdsSummary>(supabase, "ads_summary", clientId, preset);
  return (
    rows[0] ?? {
      spend_paise: 0,
      spend_untracked_paise: 0,
      unattributed_l1_revenue_paise: 0,
      unattributed_l1_count: 0,
    }
  );
}

export async function getSpendDaily(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<SpendDailyRow[]> {
  return rpcRows<SpendDailyRow>(supabase, "overview_spend_daily", clientId, preset);
}

/**
 * Per-account sync freshness for the stale/sync-in-progress notice, keyed on
 * the newest ad_sync_runs row with a non-null finished_at (a running row is
 * "sync in progress", which is distinct from stale). Two small keyed reads —
 * no aggregation, so no RPC needed.
 */
export async function getAdAccountsSyncStatus(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AdAccountSyncStatus[]> {
  const { data: accounts, error } = await supabase
    .from("ad_accounts")
    .select("id, name, meta_ad_account_id, status")
    .eq("client_id", clientId)
    .not("meta_ad_account_id", "like", "act_test_%")
    .order("connected_at");
  if (error) throw new Error(`ad_accounts read failed: ${error.message}`);
  if (!accounts || accounts.length === 0) return [];

  const ids = accounts.map((a) => a.id);
  const { data: runs, error: runsError } = await supabase
    .from("ad_sync_runs")
    .select("ad_account_id, status, finished_at, started_at")
    .in("ad_account_id", ids)
    .order("started_at", { ascending: false })
    .limit(200);
  if (runsError) throw new Error(`ad_sync_runs read failed: ${runsError.message}`);

  return accounts.map((a) => {
    const accountRuns = (runs ?? []).filter((r) => r.ad_account_id === a.id);
    const newestFinished = accountRuns.find((r) => r.finished_at !== null);
    return {
      id: a.id,
      name: a.name,
      meta_ad_account_id: a.meta_ad_account_id,
      status: a.status,
      last_finished_at: newestFinished?.finished_at ?? null,
      last_run_status: newestFinished?.status ?? null,
      running_now: accountRuns.some((r) => r.status === "running"),
    };
  });
}

/**
 * Thumbnail paths + lifecycle status for a set of ad keys — a keyed dimension
 * read (chunked under PostgREST URL limits), not an aggregation. Signed URLs
 * are minted by the caller server-side.
 */
export async function getAdThumbnails(
  supabase: SupabaseClient,
  clientId: string,
  adKeys: string[],
): Promise<Map<string, AdThumbnail>> {
  const out = new Map<string, AdThumbnail>();
  const CHUNK = 100;
  for (let i = 0; i < adKeys.length; i += CHUNK) {
    const chunk = adKeys.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("ads")
      .select("meta_ad_id, creative_thumbnail_path, status")
      .eq("client_id", clientId)
      .in("meta_ad_id", chunk);
    if (error) throw new Error(`ads thumbnail read failed: ${error.message}`);
    for (const row of data ?? []) out.set(row.meta_ad_id, row as AdThumbnail);
  }
  return out;
}

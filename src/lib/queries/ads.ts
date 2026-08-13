import type { SupabaseClient } from "@supabase/supabase-js";
import { rangeToDays, type RangePreset } from "@/lib/range";

/**
 * Ads-section read layer. Every aggregate is computed in Postgres by the RPCs
 * in migrations 20260810150000 + 20260813090000 — raw rows are never paged
 * into JS to be summed. RLS is the tenant guarantee; p_client_id is
 * defense-in-depth.
 */

export type AdsTier = "campaign" | "ad";

export type AdsBreakdownRow = {
  tier: AdsTier;
  /** Null keys are the per-level Unattributed buckets — rendered, never dropped. */
  campaign_key: string | null;
  /** Present on ad rows only (ad sets are a label, not a tier). */
  adset_key: string | null;
  ad_key: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  spend_paise: number;
  /** Meta-native delivery counts; CTR/CPM are client-side display divisions. */
  impressions: number;
  clicks: number;
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

export type AdDimensionRow = {
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  status: string;
  creative_thumbnail_path: string | null;
};

/**
 * The full ads dimension for one client — feeds the Ads cards view so
 * paused/zero-activity ads can appear even when the breakdown has no row for
 * them in range. Paged past PostgREST's 1000-row cap (the Slice C live bug:
 * Love School alone has 1,233 ads, so a single read silently truncates).
 */
export async function getAdsDimension(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AdDimensionRow[]> {
  const out: AdDimensionRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("ads")
      .select(
        "meta_ad_id, meta_adset_id, meta_campaign_id, ad_name, adset_name, campaign_name, status, creative_thumbnail_path",
      )
      .eq("client_id", clientId)
      .order("meta_ad_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ads dimension read failed: ${error.message}`);
    out.push(...((data ?? []) as AdDimensionRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}


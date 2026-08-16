import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rangeRpcArgs,
  rangeRpcArgsWithL2,
  rangeToDays,
  type RangePreset,
  type RangeState,
} from "@/lib/range";

/**
 * Overview read layer. Every aggregate is computed in Postgres by the three
 * `overview_*` RPCs (migration 20260810100000) — raw rows are never paged
 * into JS to be summed. All functions run through whatever RLS-scoped client
 * they are handed; the p_client_id argument is defense-in-depth, RLS is the
 * guarantee.
 */

export type OverviewKpis = {
  l1_revenue_paise: number;
  l1_paid_count: number;
  l2_revenue_paise: number;
  l2_count: number;
  sessions_count: number;
};

export type RevenueDailyRow = {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  l1_revenue_paise: number;
  l2_revenue_paise: number;
};

export type TopAdRow = {
  /** Null = the Unattributed bucket. */
  ad_key: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  l1_revenue_paise: number;
  l2_revenue_paise: number;
  customers_count: number;
};

export type ClientRow = { id: string; name: string };

/** All three Overview aggregates carry an L2 arm, so all three take the L2 window. */
async function rpcRows<T>(
  supabase: SupabaseClient,
  fn: string,
  clientId: string,
  state: RangeState,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, {
    p_client_id: clientId,
    ...rangeRpcArgsWithL2(state),
  });
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? []) as T[];
}

export async function getOverviewKpis(
  supabase: SupabaseClient,
  clientId: string,
  state: RangeState,
): Promise<OverviewKpis> {
  const rows = await rpcRows<OverviewKpis>(supabase, "overview_kpis", clientId, state);
  return (
    rows[0] ?? {
      l1_revenue_paise: 0,
      l1_paid_count: 0,
      l2_revenue_paise: 0,
      l2_count: 0,
      sessions_count: 0,
    }
  );
}

export async function getRevenueDaily(
  supabase: SupabaseClient,
  clientId: string,
  state: RangeState,
): Promise<RevenueDailyRow[]> {
  return rpcRows<RevenueDailyRow>(supabase, "overview_revenue_daily", clientId, state);
}

export async function getTopAds(
  supabase: SupabaseClient,
  clientId: string,
  state: RangeState,
): Promise<TopAdRow[]> {
  return rpcRows<TopAdRow>(supabase, "overview_top_ads", clientId, state);
}

/**
 * Does this client have any L2 rows at all? Gates the split-window control so
 * clients with no upsell import never see a setting that could only ever read
 * zero. A keyed existence read, not an aggregate — RLS scopes it, the
 * client_id filter is defense-in-depth.
 */
export async function hasExternalPayments(
  supabase: SupabaseClient,
  clientId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("external_payments")
    .select("id")
    .eq("client_id", clientId)
    .limit(1);
  if (error) throw new Error(`external_payments probe failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The one permitted read of `clients`: id and name, nothing else. The table
 * also carries api_key and *_secret_enc ciphertext this dashboard must never
 * select (see .claude/rules/invariants.md).
 */
export async function getClients(supabase: SupabaseClient): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");
  if (error) throw new Error(`clients read failed: ${error.message}`);
  return data ?? [];
}

const DAY_MS = 86_400_000;

/** Today's IST calendar day as YYYY-MM-DD — matches the RPCs' day_ist rule. */
export function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Inclusive window start for a preset, mirroring the SQL cutoff rule
 * `today - (p_days - 1)`. Null for all time — the caller falls back to the
 * data's own first day.
 */
export function rangeStartDay(
  preset: RangePreset,
  today: string,
): string | null {
  const days = rangeToDays(preset);
  if (days == null) return null;
  const t = Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The chart's x-axis span for a range state. In split mode it covers the union
 * of both windows, so the webinar days an L2 payment lands on are actually
 * drawn instead of falling off the right edge of the ad window. A null `from`
 * means all time — the caller falls back to the data's own first day.
 */
export function chartSpan(
  state: RangeState,
  today: string,
): { from: string | null; to: string } {
  const base =
    state.l1.kind === "custom"
      ? { from: state.l1.from as string | null, to: state.l1.to }
      : { from: rangeStartDay(state.l1.preset, today), to: today };
  if (state.l2 == null) return base;
  return {
    from: base.from == null ? null : min(base.from, state.l2.from),
    to: max(base.to, state.l2.to),
  };
}

const min = (a: string, b: string) => (a <= b ? a : b);
const max = (a: string, b: string) => (a >= b ? a : b);

/**
 * Insert zero-revenue rows for every missing day in [fromDay, toDay] so the
 * chart line dips to a truthful zero instead of interpolating across gaps.
 * Pure; both bounds are YYYY-MM-DD and inclusive.
 */
export function fillDailyGaps(
  rows: RevenueDailyRow[],
  fromDay: string,
  toDay: string,
): RevenueDailyRow[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: RevenueDailyRow[] = [];
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  for (let t = from; t <= to; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, l1_revenue_paise: 0, l2_revenue_paise: 0 });
  }
  return out;
}

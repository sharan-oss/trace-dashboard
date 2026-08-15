import type { SupabaseClient } from "@supabase/supabase-js";
import { rangeToDays, type RangePreset } from "@/lib/range";

/**
 * Customers read layer. Every aggregate is computed in Postgres by the RPCs in
 * migration 20260816090200, all of which compose `v_customers_attributed` —
 * the single definition of the customer → acquiring-ad join. Raw rows are never
 * paged into JS to be summed. RLS is the tenant guarantee; p_client_id is
 * defense-in-depth.
 *
 * The range means an ACQUISITION COHORT: customers whose first purchase falls
 * in the window, with their value counted in full even when the upsell lands
 * after it. CAC and LTV therefore describe the same people, which is what makes
 * LTV:CAC honest (design doc 2026-08-16).
 */

export type CustomersKpis = {
  cohort_customers: number;
  repeat_customers: number;
  /** Every purchase these customers have ever made, both worlds. */
  cohort_lifetime_paise: number;
  /** Meta spend in the same window — summed exactly as `ads_summary` sums it. */
  spend_paise: number;
  median_days_to_second: number | null;
  /** Acquired inside the last 7 days: upsell window still open, LTV not yet meaningful. */
  immature_customers: number;
  /** Upsell-import coverage, NOT range-filtered — a property of the data, not the range. */
  l2_rows: number;
  l2_first_day: string | null;
  l2_last_day: string | null;
};

export type CustomersByAdRow = {
  /** Null = the Unattributed bucket, always present, never dropped. */
  ad_key: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  customers: number;
  repeat_customers: number;
  cohort_lifetime_paise: number;
  spend_paise: number;
};

export type CustomersLadderRow = {
  /** 1, 2, or 3 meaning "third purchase or beyond". */
  ordinal: number;
  customers: number;
  purchases: number;
  revenue_paise: number;
};

export type TopCustomerRow = {
  customer_id: string;
  name: string;
  lifetime_paise: number;
  purchase_count: number;
  ad_key: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  days_to_second: number | null;
  has_test: boolean;
};

async function rpcRows<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? []) as T[];
}

export async function getCustomersKpis(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<CustomersKpis> {
  const rows = await rpcRows<CustomersKpis>(supabase, "customers_kpis", {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
  });
  return (
    rows[0] ?? {
      cohort_customers: 0,
      repeat_customers: 0,
      cohort_lifetime_paise: 0,
      spend_paise: 0,
      median_days_to_second: null,
      immature_customers: 0,
      l2_rows: 0,
      l2_first_day: null,
      l2_last_day: null,
    }
  );
}

export async function getCustomersByAd(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<CustomersByAdRow[]> {
  return rpcRows<CustomersByAdRow>(supabase, "customers_by_ad", {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
  });
}

export async function getCustomersLadder(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
): Promise<CustomersLadderRow[]> {
  return rpcRows<CustomersLadderRow>(supabase, "customers_ladder", {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
  });
}

export async function getTopCustomers(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
  limit = 8,
): Promise<TopCustomerRow[]> {
  return rpcRows<TopCustomerRow>(supabase, "customers_top", {
    p_client_id: clientId,
    p_days: rangeToDays(preset),
    p_limit: limit,
  });
}

/**
 * First-purchase revenue against repeat revenue, derived from the ladder so the
 * concentration bar and the ladder cannot disagree — one source, not two
 * queries computing the same split. Ordinal 1 is acquisition; everything beyond
 * it is the upsell business.
 */
export function splitFirstVsRepeat(rows: CustomersLadderRow[]): {
  firstPaise: number;
  firstPurchases: number;
  repeatPaise: number;
  repeatPurchases: number;
  totalPaise: number;
} {
  let firstPaise = 0;
  let firstPurchases = 0;
  let repeatPaise = 0;
  let repeatPurchases = 0;
  for (const r of rows) {
    if (r.ordinal === 1) {
      firstPaise += r.revenue_paise;
      firstPurchases += r.purchases;
    } else {
      repeatPaise += r.revenue_paise;
      repeatPurchases += r.purchases;
    }
  }
  return {
    firstPaise,
    firstPurchases,
    repeatPaise,
    repeatPurchases,
    totalPaise: firstPaise + repeatPaise,
  };
}

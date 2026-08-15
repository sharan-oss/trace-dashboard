import type { SupabaseClient } from "@supabase/supabase-js";
import { istToday, rangeStartDay } from "@/lib/queries/overview";
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

export type PeopleSort = "ltv" | "newest" | "fastest";
export type SortDir = "asc" | "desc";

export type PeoplePageOpts = {
  search?: string;
  sort: PeopleSort;
  dir: SortDir;
  repeatOnly: boolean;
  /** Zero-based. */
  page: number;
};

export const PEOPLE_PAGE_SIZE = 50;

export type CustomerRow = {
  customer_id: string;
  name: string;
  email_norm: string | null;
  first_paid_at: string;
  /** IST calendar day of acquisition — display this, never a UTC slice of first_paid_at. */
  acquired_day_ist: string;
  purchase_count: number;
  lifetime_paise: number;
  is_repeat: boolean;
  days_to_second: number | null;
  ad_key: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  has_test: boolean;
};

export type CustomersPage = {
  rows: CustomerRow[];
  /** Total matches across all pages, for "Showing 1–50 of N". */
  total: number;
};

/**
 * PostgREST's or() filter is itself a comma-separated mini-language, so user
 * input must not be able to smuggle `,`/`(`/`)` into it and add clauses.
 * Wildcards go too: the user typed text, not a pattern.
 */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()%*\\]/g, "").trim();
}

const SORT_COLUMN: Record<PeopleSort, string> = {
  ltv: "lifetime_paise",
  newest: "first_paid_at",
  fastest: "days_to_second",
};

/**
 * One page of the People table, straight off `v_customers_attributed` — a
 * keyed-and-ranged read with filters, so no RPC is needed and PostgREST's
 * 1000-row cap is designed out rather than worked around. The cohort filter
 * reuses rangeStartDay(), which mirrors the SQL `today - (p_days - 1)` rule,
 * so this page and the Value tab's RPCs can never disagree about who is in
 * the cohort (asserted by test).
 */
export async function getCustomersPage(
  supabase: SupabaseClient,
  clientId: string,
  preset: RangePreset,
  opts: PeoplePageOpts,
): Promise<CustomersPage> {
  let query = supabase
    .from("v_customers_attributed")
    .select(
      "customer_id, name, email_norm, first_paid_at, acquired_day_ist, purchase_count, lifetime_paise, is_repeat, days_to_second, ad_key, ad_name, campaign_name, has_test",
      { count: "exact" },
    )
    .eq("client_id", clientId);

  const fromDay = rangeStartDay(preset, istToday());
  if (fromDay != null) query = query.gte("acquired_day_ist", fromDay);

  if (opts.repeatOnly) query = query.eq("is_repeat", true);

  const q = sanitizeSearch(opts.search ?? "");
  if (q.length > 0) {
    query = query.or(`name.ilike.*${q}*,email_norm.ilike.*${q}*`);
  }

  const from = opts.page * PEOPLE_PAGE_SIZE;
  const { data, error, count } = await query
    // nullsFirst:false in both directions: "no second purchase yet" is not a
    // value of days_to_second, so it never wins a sort.
    .order(SORT_COLUMN[opts.sort], {
      ascending: opts.dir === "asc",
      nullsFirst: false,
    })
    // Deterministic tiebreak so paging cannot duplicate or drop a row when
    // many customers share a value (534 people share the ~Rs 99 LTV).
    .order("customer_id", { ascending: true })
    .range(from, from + PEOPLE_PAGE_SIZE - 1);

  if (error) throw new Error(`customers page read failed: ${error.message}`);
  return { rows: (data ?? []) as CustomerRow[], total: count ?? 0 };
}

export type TimelineEntry = {
  origin: "trace" | "external";
  source: string;
  amount: number;
  paid_at: string;
  product_name: string | null;
};

export type CustomerContext = {
  device_brand: string | null;
  device_model: string | null;
  device_os: string | null;
  network_type: string | null;
  network_speed_kbps: number | null;
  /** Sessions by this person before they bought, computed at payment time. */
  visit_count: number | null;
};

export type CustomerDetail = {
  customer: CustomerRow & { phone_norm: string | null };
  timeline: TimelineEntry[];
  context: CustomerContext | null;
};

/**
 * Everything the detail sheet shows, in three keyed reads (customer row,
 * purchase timeline, acquiring session's device context). RLS scopes each
 * one; a customer id from another tenant simply resolves to null. Nulls at
 * every level are expected — a payment can lack a session, a session can lack
 * device fields — and render as "—", never guessed.
 */
export async function getCustomerDetail(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CustomerDetail | null> {
  const { data: customer, error } = await supabase
    .from("v_customers_attributed")
    .select(
      "customer_id, name, email_norm, phone_norm, l1_payment_id, first_paid_at, acquired_day_ist, purchase_count, lifetime_paise, is_repeat, days_to_second, ad_key, ad_name, campaign_name, has_test",
    )
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`customer read failed: ${error.message}`);
  if (customer == null) return null;

  const { data: timeline, error: tErr } = await supabase
    .from("customer_payments_unified")
    .select("origin, source, amount, paid_at, product_name")
    .eq("customer_id", customerId)
    .order("paid_at", { ascending: true });
  if (tErr) throw new Error(`customer timeline read failed: ${tErr.message}`);

  let context: CustomerContext | null = null;
  const l1PaymentId = customer.l1_payment_id as string | null;
  if (l1PaymentId != null) {
    const { data: payment } = await supabase
      .from("payments")
      .select("session_id, visit_count")
      .eq("id", l1PaymentId)
      .maybeSingle();
    if (payment != null) {
      let session: {
        device_brand: string | null;
        device_model: string | null;
        device_os: string | null;
        network_type: string | null;
        network_speed_kbps: number | null;
      } | null = null;
      if (payment.session_id != null) {
        const { data } = await supabase
          .from("sessions")
          .select(
            "device_brand, device_model, device_os, network_type, network_speed_kbps",
          )
          .eq("id", payment.session_id as string)
          .maybeSingle();
        session = data ?? null;
      }
      context = {
        device_brand: session?.device_brand ?? null,
        device_model: session?.device_model ?? null,
        device_os: session?.device_os ?? null,
        network_type: session?.network_type ?? null,
        network_speed_kbps: session?.network_speed_kbps ?? null,
        visit_count: (payment.visit_count as number | null) ?? null,
      };
    }
  }

  return {
    customer: customer as CustomerDetail["customer"],
    timeline: (timeline ?? []) as TimelineEntry[],
    context,
  };
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

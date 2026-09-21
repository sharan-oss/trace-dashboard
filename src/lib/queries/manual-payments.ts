import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads behind the record-payment sheet (migration 20260921090000). Writes go
 * through the RPCs in src/app/(dashboard)/customers/actions.ts; nothing here
 * mutates. RLS scopes every read — a client user's search can only ever
 * return their own people, so clientId is defence-in-depth, not the guard.
 */

export type CustomerHit = {
  id: string;
  name: string;
  email_norm: string | null;
  phone_norm: string | null;
};

/** What the RPC returns; `outcome` decides which panel the sheet shows. */
export type RecordOutcome =
  | {
      outcome: "recorded";
      replayed: boolean;
      payment_id: string;
      customer_id: string;
      customer_name: string;
      amount_paise: number;
      created_customer: boolean;
    }
  | { outcome: "duplicate"; match: DuplicateMatch }
  | { outcome: "conflict"; email_customer: CustomerHit; phone_customer: CustomerHit };

export type DuplicateMatch = {
  id: string;
  amount_paise: number;
  paid_at: string;
  source: string;
  product_name: string | null;
  payment_method: string | null;
  customer_id: string;
  customer_name: string;
};

/** A hand-recorded payment that has been voided — shown struck through, never summed. */
export type VoidedEntry = {
  row_id: string;
  amount: number;
  paid_at: string;
  product_name: string | null;
  payment_method: string | null;
  voided_by: string | null;
  void_reason: string | null;
  voided_at: string | null;
};

/**
 * PostgREST's or() filter is a comma-separated mini-language, so user input
 * must not smuggle `,`/`(`/`)` into it. Wildcards go too: the user typed
 * text, not a pattern. Same rule as the People table's search.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()%*\\]/g, "").trim();
}

/**
 * The combobox's search: name, email or phone, across the WHOLE customer
 * list. Deliberately not `v_customers_attributed` with the People cohort
 * filter — someone acquired outside the current range is exactly who buys an
 * upsell today.
 */
export async function searchCustomersForRecord(
  supabase: SupabaseClient,
  clientId: string,
  rawQuery: string,
  limit = 8,
): Promise<CustomerHit[]> {
  const q = sanitizeSearch(rawQuery);
  if (q.length === 0) return [];
  const digits = q.replace(/\D/g, "");
  const arms = [`name.ilike.*${q}*`, `email_norm.ilike.*${q}*`];
  if (digits.length >= 4) arms.push(`phone_norm.ilike.*${digits}*`);

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email_norm, phone_norm")
    .eq("client_id", clientId)
    .or(arms.join(","))
    .order("name")
    .limit(limit);
  if (error) throw new Error(`customer search failed: ${error.message}`);
  return (data ?? []) as CustomerHit[];
}

/** Exact-key lookup for the "already exists" warning while creating a customer. */
export async function findCustomerByKeys(
  supabase: SupabaseClient,
  clientId: string,
  emailNorm: string | null,
  phoneNorm: string | null,
): Promise<CustomerHit | null> {
  if (emailNorm == null && phoneNorm == null) return null;
  const arms: string[] = [];
  if (emailNorm != null) arms.push(`email_norm.eq.${emailNorm}`);
  if (phoneNorm != null) arms.push(`phone_norm.eq.${phoneNorm}`);
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email_norm, phone_norm")
    .eq("client_id", clientId)
    .or(arms.join(","))
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`customer lookup failed: ${error.message}`);
  return (data as CustomerHit | null) ?? null;
}

/** For `?record=<customer_id>`: the person to prefill, or null when not visible. */
export async function getCustomerBrief(
  supabase: SupabaseClient,
  customerId: string,
): Promise<(CustomerHit & { client_id: string }) | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, client_id, name, email_norm, phone_norm")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(`customer brief failed: ${error.message}`);
  return (data as (CustomerHit & { client_id: string }) | null) ?? null;
}

/** The product the coach last recorded, so a batch needs typing once. */
export async function getLastManualProduct(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string> {
  const { data } = await supabase
    .from("external_payments")
    .select("product_name")
    .eq("client_id", clientId)
    .eq("source", "manual")
    .not("product_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.product_name as string | null) ?? "Coaching program";
}

/**
 * Voided hand-recorded payments for one person. customer_payments_unified
 * filters status='captured' by design, so the sheet reads these separately
 * and shows them struck through — the audit trail stays visible without ever
 * touching a total.
 */
export async function getVoidedManualPayments(
  supabase: SupabaseClient,
  customerId: string,
): Promise<VoidedEntry[]> {
  const { data, error } = await supabase
    .from("external_payments")
    .select("id, amount, paid_at, created_at, product_name, raw_payload")
    .eq("customer_id", customerId)
    .eq("source", "manual")
    .eq("status", "voided")
    .order("paid_at", { ascending: true });
  if (error) throw new Error(`voided payments read failed: ${error.message}`);
  return (data ?? []).map((r) => {
    const raw = (r.raw_payload ?? {}) as Record<string, unknown>;
    return {
      row_id: r.id as string,
      amount: r.amount as number,
      paid_at: (r.paid_at ?? r.created_at) as string,
      product_name: (r.product_name as string | null) ?? null,
      payment_method: typeof raw.method === "string" && raw.method ? raw.method : null,
      voided_by: typeof raw.voided_by === "string" ? raw.voided_by : null,
      void_reason: typeof raw.void_reason === "string" ? raw.void_reason : null,
      voided_at: typeof raw.voided_at === "string" ? raw.voided_at : null,
    };
  });
}

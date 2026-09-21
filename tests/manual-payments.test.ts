import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { presetState } from "@/lib/range";
import { getDayPayments, getRevenueDaily } from "@/lib/queries/overview";
import { normalizeEmail, normalizePhone } from "@/lib/payments/normalize";
import { adminClient, clientClient, getTestJwt } from "./helpers/supabase";
import { EMAIL_CASES, PHONE_CASES } from "./payments-normalize.test";

/**
 * The record-payment flow (migration 20260921090000): the dashboard's first
 * writes to the Trace-owned L2 tables. Proven the only way RLS can be — through
 * real RLS-scoped JWTs, never the SQL editor.
 *
 * Live DB, so every row this file creates is removed in afterAll through the
 * two test-only delete policies (rows recorded by, and fixture customers
 * addressed at, *@trace.local — a domain no Google account can hold). The
 * tenant used is the client identity's OWN client_id from its JWT (it is Love
 * School); fixtures exist only for the seconds this file runs.
 */

const createdPayments: string[] = [];
const createdCustomers: string[] = [];

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

function claimsOf(jwt: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

async function clientTenantId(): Promise<string> {
  const claims = claimsOf(await getTestJwt("client"));
  return claims.client_id as string;
}

/** Any client that is NOT the client identity's own tenant (which is Love School). */
async function foreignClientId(admin: SupabaseClient): Promise<string> {
  const own = await clientTenantId();
  const { data } = await admin.from("clients").select("id").neq("id", own).limit(1).single();
  return data!.id as string;
}

function fixtureEmail(): string {
  return `rls-test-${crypto.randomUUID()}@trace.local`;
}

/** A random 10-digit Indian-looking mobile number that cannot be a real customer's. */
function fixturePhone(): string {
  return `9${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, "0")}`;
}

const TODAY_IST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

type RecordArgs = {
  p_client_id: string;
  p_amount_paise: number;
  p_paid_day: string;
  p_method: string;
  p_idempotency_key: string;
  p_customer_id?: string | null;
  p_new_name?: string | null;
  p_new_email?: string | null;
  p_new_phone?: string | null;
  p_reference?: string | null;
  p_product_name?: string | null;
  p_note?: string | null;
  p_confirm_duplicate?: boolean;
};

async function record(supabase: SupabaseClient, args: RecordArgs) {
  const { data, error } = await supabase.rpc("record_manual_payment", args);
  if (!error && data?.outcome === "recorded") {
    createdPayments.push(data.payment_id as string);
    if (data.created_customer) createdCustomers.push(data.customer_id as string);
  }
  return { data: data as Record<string, unknown> | null, error };
}

async function newCustomerPayment(
  supabase: SupabaseClient,
  clientId: string,
  overrides: Partial<RecordArgs> = {},
) {
  return record(supabase, {
    p_client_id: clientId,
    p_amount_paise: 100,
    p_paid_day: TODAY_IST,
    p_method: "gpay",
    p_idempotency_key: crypto.randomUUID(),
    p_new_name: "RLS Test Buyer",
    p_new_email: fixtureEmail(),
    p_new_phone: fixturePhone(),
    p_product_name: "Test product",
    ...overrides,
  });
}

afterAll(async () => {
  const admin = await adminClient();
  if (createdPayments.length > 0) {
    await admin.from("external_payments").delete().in("id", createdPayments);
  }
  if (createdCustomers.length > 0) {
    await admin.from("customers").delete().in("id", createdCustomers);
  }
  // The cleanup policies are the only way test rows can leave; if they ever
  // regress, this is where it shows.
  const { count: p } = await admin
    .from("external_payments")
    .select("id", { count: "exact", head: true })
    .in("id", createdPayments.length > 0 ? createdPayments : ["00000000-0000-0000-0000-000000000000"]);
  const { count: c } = await admin
    .from("customers")
    .select("id", { count: "exact", head: true })
    .in("id", createdCustomers.length > 0 ? createdCustomers : ["00000000-0000-0000-0000-000000000000"]);
  if ((p ?? 0) > 0 || (c ?? 0) > 0) {
    throw new Error(`test rows survived cleanup: payments=${p}, customers=${c}`);
  }
});

describe("identity_normalize_* — SQL twins agree with the TS mirror", () => {
  it.each(EMAIL_CASES)("email %j", async (input, expected) => {
    const admin = await adminClient();
    const { data, error } = await admin.rpc("identity_normalize_email", { value: input });
    expect(error).toBeNull();
    expect(data).toBe(expected);
    expect(data).toBe(normalizeEmail(input));
  });

  it.each(PHONE_CASES)("phone %j", async (input, expected) => {
    const admin = await adminClient();
    const { data, error } = await admin.rpc("identity_normalize_phone", { value: input });
    expect(error).toBeNull();
    expect(data).toBe(expected);
    expect(data).toBe(normalizePhone(input));
  });
});

describe("record_manual_payment — access control", () => {
  it("denies anon outright", async () => {
    const { error } = await anonClient().rpc("record_manual_payment", {
      p_client_id: "00000000-0000-0000-0000-000000000000",
      p_amount_paise: 100,
      p_paid_day: TODAY_IST,
      p_method: "gpay",
      p_idempotency_key: crypto.randomUUID(),
      p_new_name: "x",
      p_new_email: "x@y.co",
    });
    expect(error).not.toBeNull();
  });

  it("lets a client user record for their own client, creating the L2-only customer", async () => {
    const client = await clientClient();
    const tenant = await clientTenantId();
    const { data, error } = await newCustomerPayment(client, tenant);
    expect(error).toBeNull();
    expect(data?.outcome).toBe("recorded");
    expect(data?.created_customer).toBe(true);
    expect(data?.amount_paise).toBe(100);
  });

  it("refuses a client user another tenant's customer id — it simply is not found", async () => {
    const client = await clientClient();
    const admin = await adminClient();
    const foreign = await foreignClientId(admin);
    const { data: someone } = await admin
      .from("customers")
      .select("id")
      .eq("client_id", foreign)
      .limit(1)
      .maybeSingle();
    if (someone == null) return; // that tenant has no customers to borrow
    const { error } = await record(client, {
      p_client_id: foreign,
      p_amount_paise: 100,
      p_paid_day: TODAY_IST,
      p_method: "gpay",
      p_idempotency_key: crypto.randomUUID(),
      p_customer_id: someone!.id as string,
    });
    expect(error?.code).toBe("TRNOC");
  });

  it("refuses a client user creating a customer under another tenant", async () => {
    const client = await clientClient();
    const admin = await adminClient();
    const foreign = await foreignClientId(admin);
    const { error } = await newCustomerPayment(client, foreign);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/row-level security/i);
  });

  it("pins the row shape on a direct insert: no foreign status, no order id, no forged recorder", async () => {
    const client = await clientClient();
    const tenant = await clientTenantId();
    const { data: seeded } = await newCustomerPayment(client, tenant);
    const customerId = seeded!.customer_id as string;
    const base = {
      client_id: tenant,
      customer_id: customerId,
      source: "manual",
      external_payment_id: `manual_${crypto.randomUUID()}`,
      status: "captured",
      amount: 100,
      raw_payload: { manual_entry: true, recorded_by: "dashboard-client-test@trace.local" },
    };

    const paid = await client.from("external_payments").insert({ ...base, status: "paid" });
    expect(paid.error).not.toBeNull();

    const withOrder = await client
      .from("external_payments")
      .insert({ ...base, external_order_id: "order_x" });
    // Column privilege, not a policy: the column is simply not insertable.
    expect(withOrder.error?.code).toBe("42501");

    const forged = await client.from("external_payments").insert({
      ...base,
      raw_payload: { manual_entry: true, recorded_by: "someone-else@example.com" },
    });
    expect(forged.error).not.toBeNull();
    expect(forged.error!.message).toMatch(/row-level security/i);
  });
});

describe("record_manual_payment — semantics", () => {
  it("creates the customer with first_paid_at = paid_at, and the row reconciles into every read", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    const email = fixtureEmail();
    const { data, error } = await newCustomerPayment(admin, tenant, {
      p_new_email: email,
      p_amount_paise: 12345,
      p_paid_day: TODAY_IST,
    });
    expect(error).toBeNull();
    expect(data?.created_customer).toBe(true);

    const { data: cust } = await admin
      .from("customers")
      .select("id, name, email_norm, first_paid_at, l1_payment_id")
      .eq("id", data!.customer_id as string)
      .single();
    expect(cust!.email_norm).toBe(email);
    expect(cust!.l1_payment_id).toBeNull();

    const { data: row } = await admin
      .from("external_payments")
      .select("*")
      .eq("id", data!.payment_id as string)
      .single();
    expect(row!.paid_at).toBe(cust!.first_paid_at);
    expect(row!.source).toBe("manual");
    expect(row!.status).toBe("captured");
    expect(row!.external_order_id).toBeNull();
    expect(row!.external_payment_id).toMatch(/^manual_[0-9a-f-]{36}$/);
    expect(row!.raw_payload.recorded_by).toBe("dashboard-admin-test@trace.local");
    expect(row!.raw_payload.method).toBe("gpay");
    expect(row!.description).toMatch(/GPay/);

    const { data: unified } = await admin
      .from("customer_payments_unified")
      .select("row_id, payment_method")
      .eq("customer_id", cust!.id);
    expect(unified!.map((u) => u.row_id)).toContain(row!.id);
    expect(unified![0].payment_method).toBe("gpay");

    const { data: attributed } = await admin
      .from("v_customers_attributed")
      .select("ad_key, purchase_count, acquired_day_ist")
      .eq("customer_id", cust!.id)
      .single();
    expect(attributed!.ad_key).toBeNull();
    expect(attributed!.purchase_count).toBe(1);
    expect(attributed!.acquired_day_ist).toBe(TODAY_IST);

    const day = await getDayPayments(admin, tenant, TODAY_IST, presetState("all"));
    const mine = day.find((r) => r.row_id === row!.id);
    expect(mine?.arm).toBe("l2");
    expect(mine?.source).toBe("manual");
    expect(mine?.payment_method).toBe("gpay");
  });

  it("matches an existing customer through normalisation instead of creating a twin", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    const email = fixtureEmail();
    const phone = fixturePhone();
    const first = await newCustomerPayment(admin, tenant, {
      p_new_email: email,
      p_new_phone: phone,
    });
    const second = await newCustomerPayment(admin, tenant, {
      p_new_email: ` ${email.toUpperCase()} `,
      p_new_phone: `+91 ${phone}`,
      p_amount_paise: 200,
    });
    expect(second.error).toBeNull();
    expect(second.data?.created_customer).toBe(false);
    expect(second.data?.customer_id).toBe(first.data?.customer_id);
  });

  it("flags a same-day same-amount payment as a duplicate, and records it only when confirmed", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    const first = await newCustomerPayment(admin, tenant, { p_amount_paise: 777 });
    const customerId = first.data!.customer_id as string;

    const again = await record(admin, {
      p_client_id: tenant,
      p_amount_paise: 777,
      p_paid_day: TODAY_IST,
      p_method: "cash",
      p_idempotency_key: crypto.randomUUID(),
      p_customer_id: customerId,
    });
    expect(again.error).toBeNull();
    expect(again.data?.outcome).toBe("duplicate");
    const match = again.data!.match as Record<string, unknown>;
    expect(match.id).toBe(first.data!.payment_id);
    expect(match.payment_method).toBe("gpay");

    const other = await record(admin, {
      p_client_id: tenant,
      p_amount_paise: 778,
      p_paid_day: TODAY_IST,
      p_method: "cash",
      p_idempotency_key: crypto.randomUUID(),
      p_customer_id: customerId,
    });
    expect(other.data?.outcome).toBe("recorded");

    const confirmed = await record(admin, {
      p_client_id: tenant,
      p_amount_paise: 777,
      p_paid_day: TODAY_IST,
      p_method: "cash",
      p_idempotency_key: crypto.randomUUID(),
      p_customer_id: customerId,
      p_confirm_duplicate: true,
    });
    expect(confirmed.data?.outcome).toBe("recorded");
    const { data: row } = await admin
      .from("external_payments")
      .select("raw_payload")
      .eq("id", confirmed.data!.payment_id as string)
      .single();
    expect(row!.raw_payload.confirmed_duplicate).toBe(true);
  });

  it("surfaces two different customers matching email and phone as a conflict, writing nothing", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    // Both fixtures keep a trace.local email so the cleanup policy can see
    // them; the conflict comes from crossing A's email with B's phone.
    const a = await newCustomerPayment(admin, tenant);
    const b = await newCustomerPayment(admin, tenant);
    const { data: aRow } = await admin
      .from("customers")
      .select("email_norm")
      .eq("id", a.data!.customer_id as string)
      .single();
    const { data: bRow } = await admin
      .from("customers")
      .select("phone_norm")
      .eq("id", b.data!.customer_id as string)
      .single();

    const before = createdPayments.length;
    const res = await newCustomerPayment(admin, tenant, {
      p_new_email: aRow!.email_norm,
      p_new_phone: bRow!.phone_norm,
    });
    expect(res.error).toBeNull();
    expect(res.data?.outcome).toBe("conflict");
    expect((res.data!.email_customer as { id: string }).id).toBe(a.data!.customer_id);
    expect((res.data!.phone_customer as { id: string }).id).toBe(b.data!.customer_id);
    expect(createdPayments.length).toBe(before);
  });

  it("replays the same idempotency key instead of writing twice", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    const key = crypto.randomUUID();
    const first = await newCustomerPayment(admin, tenant, { p_idempotency_key: key });
    const again = await record(admin, {
      p_client_id: tenant,
      p_amount_paise: 100,
      p_paid_day: TODAY_IST,
      p_method: "gpay",
      p_idempotency_key: key,
      p_customer_id: first.data!.customer_id as string,
    });
    expect(again.data?.outcome).toBe("recorded");
    expect(again.data?.replayed).toBe(true);
    expect(again.data?.payment_id).toBe(first.data?.payment_id);
    const { count } = await admin
      .from("external_payments")
      .select("id", { count: "exact", head: true })
      .eq("external_payment_id", `manual_${key}`);
    expect(count).toBe(1);
  });

  it("rejects bad input with a field-keyed TRVAL that PostgREST surfaces", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    const future = await newCustomerPayment(admin, tenant, { p_paid_day: "2099-01-01" });
    expect(future.error?.code).toBe("TRVAL");
    expect(future.error?.details).toContain("paidDay");
    const venmo = await newCustomerPayment(admin, tenant, { p_method: "venmo" });
    expect(venmo.error?.code).toBe("TRVAL");
    expect(venmo.error?.details).toContain("method");
  });
});

describe("void_manual_payment", () => {
  it("admin voids; the row leaves every number but keeps its audit trail", async () => {
    const admin = await adminClient();
    const tenant = await clientTenantId();
    const rec = await newCustomerPayment(admin, tenant, { p_amount_paise: 4321 });
    const paymentId = rec.data!.payment_id as string;

    const dailyBefore = (await getRevenueDaily(admin, tenant, presetState("all"))).find(
      (d) => d.day === TODAY_IST,
    );

    const { data, error } = await admin.rpc("void_manual_payment", {
      p_id: paymentId,
      p_reason: "test void",
    });
    expect(error).toBeNull();
    expect(data.voided_by).toBe("dashboard-admin-test@trace.local");

    const { data: row } = await admin
      .from("external_payments")
      .select("status, raw_payload")
      .eq("id", paymentId)
      .single();
    expect(row!.status).toBe("voided");
    expect(row!.raw_payload.void_reason).toBe("test void");
    expect(row!.raw_payload.recorded_by).toBe("dashboard-admin-test@trace.local");

    const { data: unified } = await admin
      .from("customer_payments_unified")
      .select("row_id")
      .eq("row_id", paymentId);
    expect(unified).toEqual([]);
    const day = await getDayPayments(admin, tenant, TODAY_IST, presetState("all"));
    expect(day.find((r) => r.row_id === paymentId)).toBeUndefined();
    const dailyAfter = (await getRevenueDaily(admin, tenant, presetState("all"))).find(
      (d) => d.day === TODAY_IST,
    );
    expect((dailyBefore?.l2_revenue_paise ?? 0) - (dailyAfter?.l2_revenue_paise ?? 0)).toBe(4321);

    const twice = await admin.rpc("void_manual_payment", { p_id: paymentId, p_reason: "again" });
    expect(twice.error?.code).toBe("TRNOV");
  });

  it("a client user cannot void — the update matches no policy row", async () => {
    const admin = await adminClient();
    const client = await clientClient();
    const tenant = await clientTenantId();
    const rec = await newCustomerPayment(admin, tenant);
    const paymentId = rec.data!.payment_id as string;
    const { error } = await client.rpc("void_manual_payment", {
      p_id: paymentId,
      p_reason: "not allowed",
    });
    expect(error?.code).toBe("TRNOV");
    const { data: row } = await admin
      .from("external_payments")
      .select("status")
      .eq("id", paymentId)
      .single();
    expect(row!.status).toBe("captured");
  });

  it("requires a reason", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("void_manual_payment", {
      p_id: "00000000-0000-0000-0000-000000000000",
      p_reason: "  ",
    });
    expect(error?.code).toBe("TRVAL");
  });
});

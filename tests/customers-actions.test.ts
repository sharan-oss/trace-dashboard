/**
 * The record/void server actions, invoked directly with FormData — no server.
 * Identity, cookies and the Supabase client are stubbed to the admin TEST
 * identity (so the RLS-scoped writes are the real ones the RPC tests prove);
 * everything else — zod, the RPC, the outcome/error mapping — runs for real
 * against the live database. Rows are cleaned up through the test-only delete
 * policies, exactly as tests/manual-payments.test.ts does.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Identity } from "@/lib/auth/session";
import { adminClient } from "./helpers/supabase";

const LOVE_SCHOOL = "cb7daf9d-28f1-4699-a587-afb6e2ec44da";

let identity: Identity | null = {
  email: "dashboard-admin-test@trace.local",
  isAdmin: true,
  isSuper: false,
  clientId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getIdentity: async () => identity,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: LOVE_SCHOOL }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => adminClient(),
}));

const createdPayments: string[] = [];
const createdCustomers: string[] = [];

afterAll(async () => {
  const admin = await adminClient();
  if (createdPayments.length) await admin.from("external_payments").delete().in("id", createdPayments);
  if (createdCustomers.length) await admin.from("customers").delete().in("id", createdCustomers);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function newBuyer(overrides: Record<string, string> = {}) {
  return form({
    customerMode: "new",
    customerId: "",
    newName: "Action Test Buyer",
    newEmail: `rls-test-${crypto.randomUUID()}@trace.local`,
    newPhone: "",
    amount: "₹ 9,724.20",
    paidDay: TODAY,
    method: "gpay",
    reference: "123456789012",
    productName: "Coaching program",
    note: "from the action test",
    idempotencyKey: crypto.randomUUID(),
    confirmDuplicate: "",
    ...overrides,
  });
}

async function actions() {
  return import("@/app/(dashboard)/customers/actions");
}

describe("recordManualPayment", () => {
  it("records a new buyer end to end and echoes the key", async () => {
    const { recordManualPayment } = await actions();
    const fd = newBuyer();
    const state = await recordManualPayment({}, fd);
    expect(state.error).toBeUndefined();
    expect(state.fieldErrors).toBeUndefined();
    expect(state.key).toBe(fd.get("idempotencyKey"));
    expect(state.recorded?.amountPaise).toBe(972420);
    expect(state.recorded?.createdCustomer).toBe(true);
    expect(state.recorded?.customerName).toBe("Action Test Buyer");
    createdPayments.push(state.recorded!.paymentId);
    createdCustomers.push(state.recorded!.customerId);

    const admin = await adminClient();
    const { data } = await admin
      .from("external_payments")
      .select("client_id, raw_payload, description")
      .eq("id", state.recorded!.paymentId)
      .single();
    expect(data!.client_id).toBe(LOVE_SCHOOL); // from the cookie, never the form
    expect(data!.raw_payload.reference).toBe("123456789012");
    expect(data!.raw_payload.note).toBe("from the action test");
    expect(data!.raw_payload.recorded_by).toBe("dashboard-admin-test@trace.local");
  });

  it("returns field errors from the shared schema without touching the database", async () => {
    const { recordManualPayment } = await actions();
    const state = await recordManualPayment({}, newBuyer({ amount: "abc", paidDay: "2099-01-01" }));
    expect(state.fieldErrors?.amount).toMatch(/amount/i);
    expect(state.fieldErrors?.paidDay).toMatch(/future/i);
    expect(state.recorded).toBeUndefined();
  });

  it("maps the RPC's duplicate outcome, then records on confirm", async () => {
    const { recordManualPayment } = await actions();
    const first = await recordManualPayment({}, newBuyer({ amount: "555" }));
    createdPayments.push(first.recorded!.paymentId);
    createdCustomers.push(first.recorded!.customerId);

    const again = form({
      customerMode: "existing",
      customerId: first.recorded!.customerId,
      amount: "555",
      paidDay: TODAY,
      method: "cash",
      idempotencyKey: crypto.randomUUID(),
    });
    const dup = await recordManualPayment({}, again);
    expect(dup.duplicate?.id).toBe(first.recorded!.paymentId);
    expect(dup.duplicate?.payment_method).toBe("gpay");
    expect(dup.recorded).toBeUndefined();

    again.set("confirmDuplicate", "1");
    const confirmed = await recordManualPayment({}, again);
    expect(confirmed.recorded?.paymentId).toBeDefined();
    createdPayments.push(confirmed.recorded!.paymentId);
  });

  it("refuses a client user of another client before reaching the database", async () => {
    const { recordManualPayment } = await actions();
    identity = { email: "coach@example.com", isAdmin: false, isSuper: false, clientId: "00000000-0000-0000-0000-000000000000" };
    try {
      const state = await recordManualPayment({}, newBuyer());
      expect(state.error).toMatch(/can't record payments for this client/i);
      expect(state.recorded).toBeUndefined();
    } finally {
      identity = { email: "dashboard-admin-test@trace.local", isAdmin: true, isSuper: false, clientId: null };
    }
  });
});

describe("voidManualPayment", () => {
  it("voids a recorded payment with a reason, and refuses without one", async () => {
    const { recordManualPayment, voidManualPayment } = await actions();
    const rec = await recordManualPayment({}, newBuyer({ amount: "1" }));
    createdPayments.push(rec.recorded!.paymentId);
    createdCustomers.push(rec.recorded!.customerId);

    const missing = await voidManualPayment({}, form({ id: rec.recorded!.paymentId, reason: "  " }));
    expect(missing.error).toMatch(/reason/i);

    const ok = await voidManualPayment({}, form({ id: rec.recorded!.paymentId, reason: "entered twice" }));
    expect(ok).toEqual({ ok: true });

    const twice = await voidManualPayment({}, form({ id: rec.recorded!.paymentId, reason: "again" }));
    expect(twice.error).toMatch(/only a captured/i);
  });
});

describe("searchCustomers", () => {
  it("finds a person by name, email fragment and phone digits within the selected client", async () => {
    const { searchCustomers } = await actions();
    const byName = await searchCustomers("jolly");
    expect(byName.some((h) => h.email_norm === "jjain1737@gmail.com")).toBe(true);
    const byEmail = await searchCustomers("jjain1737");
    expect(byEmail.some((h) => h.name === "jolly jain")).toBe(true);
    const byPhone = await searchCustomers("98181 21133");
    expect(byPhone.some((h) => h.phone_norm === "9818121133")).toBe(true);
    expect(await searchCustomers("   ")).toEqual([]);
  });
});

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { adminClient, clientClient, countRows } from "./helpers/supabase";

/**
 * Regression tests for the 2026-08-09 L2 data leak.
 *
 * The two L2 views were created without security_invoker, so they executed as
 * their owner and bypassed RLS on customers, external_payments and payments.
 * Measured as the anon role before the fix: 652 rows from customer_spend across
 * two different clients, including every customer's email, phone and lifetime
 * spend. The anon role is what anyone holding the publishable key gets, and
 * that key ships to the browser.
 *
 * These assertions must never be relaxed. If the anon counts stop being zero,
 * customer PII is public again.
 */

const L2_RELATIONS = [
  "customers",
  "external_payments",
  "sync_runs",
  "customer_spend",
  "customer_payments_unified",
] as const;

/** A client carrying no JWT at all — the anon role, i.e. publishable key only. */
function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

describe("L2 objects — anonymous access is fully denied", () => {
  it.each(L2_RELATIONS)("returns zero rows from %s to an unauthenticated caller", async (relation) => {
    const { count, error } = await anonClient()
      .from(relation)
      .select("*", { count: "exact", head: true });

    // Either an outright error or a zero count is acceptable; a positive count
    // is the leak.
    if (!error) expect(count ?? 0).toBe(0);
  });

  it("never exposes customer contact details anonymously", async () => {
    const { data, error } = await anonClient().from("customer_spend").select("*").limit(5);
    if (!error) expect(data ?? []).toHaveLength(0);
  });
});

describe("L2 objects — admin can read", () => {
  it.each(L2_RELATIONS)("returns rows from %s to the admin identity", async (relation) => {
    const admin = await adminClient();
    const { error } = await admin.from(relation).select("*", { count: "exact", head: true });
    expect(error).toBeNull();
  });

  it("sees external payments and customers as admin", async () => {
    const admin = await adminClient();
    expect(await countRows(admin, "external_payments")).toBeGreaterThan(0);
    expect(await countRows(admin, "customers")).toBeGreaterThan(0);
  });
});

describe("L2 objects — the client identity is scoped to its own rows", () => {
  it("shows a client strictly fewer customers than admin sees", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, "customers"),
      countRows(client, "customers"),
    ]);
    expect(adminCount).toBeGreaterThan(0);
    expect(clientCount).toBeLessThan(adminCount);
  });

  it("returns at most one client_id to the client identity, on every L2 relation", async () => {
    const client = await clientClient();
    for (const relation of ["customers", "external_payments", "customer_spend"] as const) {
      const { data, error } = await client.from(relation).select("client_id").limit(2000);
      if (error) throw new Error(`${relation}: ${error.message}`);
      const distinct = new Set((data ?? []).map((r) => r.client_id));
      expect(distinct.size, `${relation} leaked ${distinct.size} client_ids`).toBeLessThanOrEqual(1);
    }
  });

  it("scopes the unified payments view to one client", async () => {
    const client = await clientClient();
    const { data, error } = await client
      .from("customer_payments_unified")
      .select("client_id")
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(new Set((data ?? []).map((r) => r.client_id)).size).toBeLessThanOrEqual(1);
  });
});

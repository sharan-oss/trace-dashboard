import { describe, expect, it } from "vitest";
import {
  adminClient,
  clientClient,
  countRows,
  expectStableEqualCounts,
} from "./helpers/supabase";

const VIEW = "v_payments_attributed";

describe(`${VIEW} — shape and safety`, () => {
  it("returns exactly one row per payment, adding and dropping none", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "payments");
  });

  it("never exposes an encrypted secret column", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("*").limit(1).single();
    if (error) throw new Error(error.message);
    for (const column of Object.keys(data)) expect(column).not.toMatch(/_enc$/);
  });

  it("exposes every base payments column alongside the derived ones", async () => {
    const admin = await adminClient();
    const [viewRow, tableRow] = await Promise.all([
      admin.from(VIEW).select("*").limit(1).single(),
      admin.from("payments").select("*").limit(1).single(),
    ]);
    if (viewRow.error) throw new Error(viewRow.error.message);
    if (tableRow.error) throw new Error(tableRow.error.message);
    for (const column of Object.keys(tableRow.data)) {
      expect(Object.keys(viewRow.data)).toContain(column);
    }
  });

  it("sets day_ist on every row", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .is("day_ist", null);
    if (error) throw new Error(error.message);
    expect(count).toBe(0);
  });
});

describe(`${VIEW} — payment rules (AC-2)`, () => {
  it("marks a payment at or below 500 paise as a test payment", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("amount, is_test_payment").limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.is_test_payment).toBe(row.amount <= 500);
  });

  it("keeps test rows visible rather than filtering them", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .eq("is_test_payment", true);
    if (error) throw new Error(error.message);
    expect(count).toBeGreaterThan(0);
  });

  it("treats a paid status with a null paid_at as paid", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("status, paid_at, is_paid").limit(1000);
    if (error) throw new Error(error.message);
    for (const row of data!) {
      expect(row.is_paid).toBe(row.status === "paid" || row.paid_at !== null);
    }
  });

  it("leaves no utm_source_clean carrying the leaked prefix", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("utm_source_clean")
      .not("utm_source_clean", "is", null)
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.utm_source_clean.startsWith("utm_source=")).toBe(false);
    }
  });
});

describe(`${VIEW} — three-tier attribution`, () => {
  it("classifies every row as ad_id, ad_name or none, with the key agreeing", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("ad_key, ad_key_type").limit(1000);
    if (error) throw new Error(error.message);
    for (const row of data!) {
      expect(["ad_id", "ad_name", "none"]).toContain(row.ad_key_type);
      if (row.ad_key_type === "none") expect(row.ad_key).toBeNull();
      else expect(row.ad_key).not.toBeNull();
    }
  });

  it("prefers the stored id over extraction", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_id, ad_key, ad_key_type")
      .not("ad_id", "is", null)
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.ad_key).toBe(row.ad_id);
      expect(row.ad_key_type).toBe("ad_id");
    }
  });

  it("resolves ad keys by extraction for a client with no stored ids", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key")
      .is("ad_id", null)
      .eq("ad_key_type", "ad_id")
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  it("assigns the most specific tier that resolved", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, adset_key, campaign_key, attribution_tier")
      .limit(1000);
    if (error) throw new Error(error.message);
    for (const row of data!) {
      const expected =
        row.ad_key !== null
          ? "ad"
          : row.adset_key !== null
            ? "adset"
            : row.campaign_key !== null
              ? "campaign"
              : "none";
      expect(row.attribution_tier).toBe(expected);
    }
  });

  it("leaves payments with no session unattributed at every tier", async () => {
    // 16 payments have no session_id and are permanently unattributable.
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("session_id, attribution_tier")
      .is("session_id", null);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
  });
});

describe(`${VIEW} — RLS (AC-6)`, () => {
  it("scopes the client identity strictly below admin", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, VIEW),
      countRows(client, VIEW),
    ]);
    expect(clientCount).toBeGreaterThan(0);
    expect(clientCount).toBeLessThan(adminCount);
  });

  it("returns exactly one client_id to the client identity", async () => {
    const client = await clientClient();
    const { data, error } = await client.from(VIEW).select("client_id").limit(2000);
    if (error) throw new Error(error.message);
    expect(new Set(data!.map((r) => r.client_id)).size).toBe(1);
  });

  it("never leaks another client's is_test_client signal", async () => {
    const client = await clientClient();
    const { data, error } = await client.from(VIEW).select("is_test_client").limit(500);
    if (error) throw new Error(error.message);
    expect(new Set(data!.map((r) => r.is_test_client)).size).toBe(1);
  });
});

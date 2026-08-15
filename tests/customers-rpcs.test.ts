/**
 * Customers Value-tab data layer, tested through the app's own query wrappers
 * against the live DB. Doctrine as elsewhere: assert relationships and
 * invariants, never absolute counts — rows arrive while the suite runs, so
 * cross-source equalities retry a few times before failing.
 *
 * The invariants here are the page's whole claim to precision. If the ladder
 * stops summing to cohort value, or the acquisition table stops summing to the
 * customer count, the page is quietly lying about where the money came from,
 * and no visual review would catch it.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { adminClient, clientClient } from "./helpers/supabase";
import {
  getCustomersByAd,
  getCustomersKpis,
  getCustomersLadder,
  getTopCustomers,
  splitFirstVsRepeat,
} from "@/lib/queries/customers";

const OTHER_CLIENT = "00000000-0000-0000-0000-000000000000";

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

async function loveSchoolId() {
  const admin = await adminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id")
    .eq("name", "Love School")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function attemptStable(
  check: () => Promise<void>,
  attempts = 3,
): Promise<void> {
  for (let i = 1; ; i += 1) {
    try {
      await check();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
    }
  }
}

describe("customers RPCs — reconciliation invariants", () => {
  it("the ladder partitions every purchase: its revenue sums to cohort lifetime value", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [kpis, ladder] = await Promise.all([
        getCustomersKpis(admin, clientId, "all"),
        getCustomersLadder(admin, clientId, "all"),
      ]);
      const total = ladder.reduce((t, r) => t + r.revenue_paise, 0);
      expect(total).toBe(kpis.cohort_lifetime_paise);
    });
  });

  it("ordinal 1 counts exactly the cohort, and ordinal 2 exactly the repeaters", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [kpis, ladder] = await Promise.all([
        getCustomersKpis(admin, clientId, "all"),
        getCustomersLadder(admin, clientId, "all"),
      ]);
      const first = ladder.find((r) => r.ordinal === 1);
      const second = ladder.find((r) => r.ordinal === 2);
      expect(first?.customers ?? 0).toBe(kpis.cohort_customers);
      expect(second?.customers ?? 0).toBe(kpis.repeat_customers);
    });
  });

  it("the concentration bar split is exhaustive — first + repeat = cohort value", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const ladder = await getCustomersLadder(admin, clientId, "all");
    const split = splitFirstVsRepeat(ladder);
    expect(split.firstPaise + split.repeatPaise).toBe(split.totalPaise);
    expect(split.totalPaise).toBe(
      ladder.reduce((t, r) => t + r.revenue_paise, 0),
    );
  });

  it("customers_by_ad rows plus Unattributed account for every customer and every rupee", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [kpis, byAd] = await Promise.all([
        getCustomersKpis(admin, clientId, "all"),
        getCustomersByAd(admin, clientId, "all"),
      ]);
      const sum = (f: (r: (typeof byAd)[number]) => number) =>
        byAd.reduce((t, r) => t + f(r), 0);
      expect(sum((r) => r.customers)).toBe(kpis.cohort_customers);
      expect(sum((r) => r.repeat_customers)).toBe(kpis.repeat_customers);
      expect(sum((r) => r.cohort_lifetime_paise)).toBe(
        kpis.cohort_lifetime_paise,
      );
      // Same spend the KPI tile shows, so CAC here and Meta spend on /ads
      // can never disagree.
      expect(sum((r) => r.spend_paise)).toBe(kpis.spend_paise);
    });
  });

  it("always emits the Unattributed bucket, even when it is empty", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    for (const range of ["7d", "30d", "all"] as const) {
      const rows = await getCustomersByAd(admin, clientId, range);
      expect(rows.some((r) => r.ad_key == null)).toBe(true);
    }
  });
});

describe("customers RPCs — cohort semantics", () => {
  it("counts a customer in the range they FIRST paid in, not a later one", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();

    // Every customer in the 7d cohort must have acquired inside that window.
    // Verified through the view, which is where the cohort rule is defined.
    const { data, error } = await admin
      .from("v_customers_attributed")
      .select("acquired_day_ist, last_paid_at")
      .eq("client_id", clientId)
      .order("acquired_day_ist", { ascending: true })
      .limit(1000);
    expect(error).toBeNull();

    const kpis7 = await getCustomersKpis(admin, clientId, "7d");
    const cutoff = new Date(
      Date.now() - 6 * 86_400_000,
    ).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const inWindow = (data ?? []).filter(
      (r) => (r.acquired_day_ist as string) >= cutoff,
    ).length;
    expect(kpis7.cohort_customers).toBe(inWindow);
  });

  it("first_paid_at agrees with the customer's earliest actual purchase", async () => {
    // The cohort key is customers.first_paid_at. If it ever drifted from the
    // real first purchase, every cohort would silently shift. Checked over a
    // page of live rows rather than trusting the column.
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const { data: rows, error } = await admin
      .from("v_customers_attributed")
      .select("customer_id, first_paid_at")
      .eq("client_id", clientId)
      .order("first_paid_at", { ascending: false })
      .limit(25);
    expect(error).toBeNull();
    expect(rows!.length).toBeGreaterThan(0);

    for (const row of rows!) {
      const { data: purchases, error: pErr } = await admin
        .from("customer_payments_unified")
        .select("paid_at")
        .eq("customer_id", row.customer_id as string)
        .order("paid_at", { ascending: true })
        .limit(1);
      expect(pErr).toBeNull();
      if ((purchases ?? []).length === 0) continue;
      expect(new Date(row.first_paid_at as string).getTime()).toBe(
        new Date(purchases![0].paid_at as string).getTime(),
      );
    }
  });

  it("lifetime value matches the customer's own summed purchases (SDK oracle)", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const top = await getTopCustomers(admin, clientId, "all", 5);
    expect(top.length).toBeGreaterThan(0);

    for (const customer of top) {
      const { data, error } = await admin
        .from("customer_payments_unified")
        .select("amount")
        .eq("customer_id", customer.customer_id);
      expect(error).toBeNull();
      const summed = (data ?? []).reduce(
        (t, r) => t + Number(r.amount),
        0,
      );
      expect(customer.lifetime_paise).toBe(summed);
      expect(customer.purchase_count).toBe((data ?? []).length);
    }
  });

  it("widening the range never shrinks the cohort or its value", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [d7, d30, all] = await Promise.all([
        getCustomersKpis(admin, clientId, "7d"),
        getCustomersKpis(admin, clientId, "30d"),
        getCustomersKpis(admin, clientId, "all"),
      ]);
      expect(d30.cohort_customers).toBeGreaterThanOrEqual(d7.cohort_customers);
      expect(all.cohort_customers).toBeGreaterThanOrEqual(d30.cohort_customers);
      expect(all.cohort_lifetime_paise).toBeGreaterThanOrEqual(
        d30.cohort_lifetime_paise,
      );
      expect(all.spend_paise).toBeGreaterThanOrEqual(d30.spend_paise);
    });
  });

  it("upsell coverage describes all history, so it does not move with the range", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const [d7, all] = await Promise.all([
      getCustomersKpis(admin, clientId, "7d"),
      getCustomersKpis(admin, clientId, "all"),
    ]);
    expect(d7.l2_rows).toBe(all.l2_rows);
    expect(d7.l2_first_day).toBe(all.l2_first_day);
    expect(d7.l2_last_day).toBe(all.l2_last_day);
  });
});

describe("customers RPCs — tenant scoping", () => {
  it("a scoped client identity sees zeros for another tenant", async () => {
    const client = await clientClient();
    const kpis = await getCustomersKpis(client, OTHER_CLIENT, "all");
    expect(kpis.cohort_customers).toBe(0);
    expect(kpis.cohort_lifetime_paise).toBe(0);

    const byAd = await getCustomersByAd(client, OTHER_CLIENT, "all");
    expect(byAd.reduce((t, r) => t + r.customers, 0)).toBe(0);

    const top = await getTopCustomers(client, OTHER_CLIENT, "all");
    expect(top).toHaveLength(0);
  });

  it("anon is refused by every customers RPC and by the view", async () => {
    // The regression class of the 2026-08-09 leak: anon holds the publishable
    // key, which ships to the browser. It must not reach customer PII by any
    // path — not the view, not an RPC that reads it.
    const anon = anonClient();
    const clientId = await loveSchoolId();

    for (const fn of [
      "customers_kpis",
      "customers_by_ad",
      "customers_ladder",
      "customers_top",
    ]) {
      const { error } = await anon.rpc(fn, {
        p_client_id: clientId,
        p_days: null,
      });
      expect(error, `${fn} must refuse anon`).not.toBeNull();
    }

    const { error: viewError } = await anon
      .from("v_customers_attributed")
      .select("customer_id")
      .limit(1);
    expect(viewError).not.toBeNull();

    // And the L2 views it is built on, hardened by 20260816090000.
    for (const view of ["customer_spend", "customer_payments_unified"]) {
      const { error } = await anon.from(view).select("client_id").limit(1);
      expect(error, `${view} must refuse anon`).not.toBeNull();
    }
  });
});

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { adminClient, clientClient } from "./helpers/supabase";
import {
  fillDailyGaps,
  getClients,
  getOverviewKpis,
  getRevenueDaily,
  getTopAds,
  rangeStartDay,
  type RevenueDailyRow,
} from "@/lib/queries/overview";

/**
 * Tests for the three Overview aggregate RPCs
 * (supabase/migrations/20260810100000_overview_aggregate_rpcs.sql) through
 * the app's own query wrappers. Live DB: assert relationships and
 * invariants, never absolute counts — rows arrive while the suite runs, so
 * cross-call reconciliations retry a few times before failing.
 */

/** A client carrying no JWT at all — the anon role, publishable key only. */
function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

/** Retry a reconciliation that can legitimately race live inserts. */
async function attemptStable(check: () => Promise<void>, attempts = 3) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function loveSchoolId(admin: SupabaseClient): Promise<string> {
  const clients = await getClients(admin);
  const ls = clients.find((c) => c.name === "Love School");
  if (!ls) throw new Error("Love School client not found");
  return ls.id;
}

/** Page through all rows so the oracle never truncates at PostgREST's cap. */
async function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

describe("overview_kpis — reconciliation and invariants", () => {
  it("matches an oracle sum over v_payments_attributed for all time", async () => {
    // Catches: a missing is_paid filter, missing client scoping, or summing
    // the wrong column. The oracle pages raw rows in the TEST only — the
    // app-code ban on JS summation stands.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);

    await attemptStable(async () => {
      const kpis = await getOverviewKpis(admin, ls, "all");
      const rows = await pageAll(async (from, to) => {
        const { data, error } = await admin
          .from("v_payments_attributed")
          .select("amount")
          .eq("client_id", ls)
          .eq("is_paid", true)
          .range(from, to);
        if (error) throw new Error(error.message);
        return data ?? [];
      });
      const oracle = rows.reduce((sum, r) => sum + r.amount, 0);
      expect(kpis.l1_revenue_paise).toBe(oracle);
      expect(kpis.l1_paid_count).toBe(rows.length);
    });
  });

  it("applies the L2 dedupe guard exactly", async () => {
    // Catches: a missing guard (re-imported L1 rows double-counted) and an
    // inverted guard (all L2 excluded). Verified live 2026-08-10: no
    // external_order_id currently matches a payments.order_id, so the guard
    // is a no-op today — this oracle recomputes rather than assumes that.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);

    await attemptStable(async () => {
      const kpis = await getOverviewKpis(admin, ls, "all");
      const { data: externals, error } = await admin
        .from("external_payments")
        .select("amount, external_order_id")
        .eq("client_id", ls)
        .eq("status", "captured");
      if (error) throw new Error(error.message);
      const orderIds = (externals ?? [])
        .map((r) => r.external_order_id)
        .filter((id): id is string => id != null);
      const { data: dupes, error: dupErr } = orderIds.length
        ? await admin
            .from("payments")
            .select("order_id")
            .eq("client_id", ls)
            .in("order_id", orderIds)
        : { data: [], error: null };
      if (dupErr) throw new Error(dupErr.message);
      const dupeSet = new Set((dupes ?? []).map((r) => r.order_id));
      const oracle = (externals ?? [])
        .filter((r) => !dupeSet.has(r.external_order_id))
        .reduce((sum, r) => sum + r.amount, 0);
      expect(kpis.l2_revenue_paise).toBe(oracle);
    });
  });

  it("is monotonic across widening ranges", async () => {
    // Catches: an inverted date comparison and off-by-one overcounting.
    // Called in widening order so live inserts can only preserve ≤.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const k7 = await getOverviewKpis(admin, ls, "7d");
    const k30 = await getOverviewKpis(admin, ls, "30d");
    const kAll = await getOverviewKpis(admin, ls, "all");
    for (const key of [
      "l1_revenue_paise",
      "l1_paid_count",
      "l2_revenue_paise",
      "l2_count",
      "sessions_count",
    ] as const) {
      expect(k7[key], `${key}: 7d ≤ 30d`).toBeLessThanOrEqual(k30[key]);
      expect(k30[key], `${key}: 30d ≤ all`).toBeLessThanOrEqual(kAll[key]);
    }
  });
});

describe("overview_revenue_daily — reconciliation", () => {
  it("sums to the KPI totals over the same range", async () => {
    // Catches: IST boundary bugs dropping edge days, and join fan-out
    // duplicating amounts in the daily rollup.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);

    await attemptStable(async () => {
      const [kpis, daily] = await Promise.all([
        getOverviewKpis(admin, ls, "30d"),
        getRevenueDaily(admin, ls, "30d"),
      ]);
      const l1 = daily.reduce((s, d) => s + d.l1_revenue_paise, 0);
      const l2 = daily.reduce((s, d) => s + d.l2_revenue_paise, 0);
      expect(l1).toBe(kpis.l1_revenue_paise);
      expect(l2).toBe(kpis.l2_revenue_paise);
    });
  });

  it("returns days sorted ascending with no duplicates", async () => {
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const daily = await getRevenueDaily(admin, ls, "all");
    const days = daily.map((d) => d.day);
    expect(days).toEqual([...days].sort());
    expect(new Set(days).size).toBe(days.length);
  });
});

describe("overview_top_ads — reconciliation and grouping", () => {
  it("sums across all groups (including Unattributed) to the KPI totals", async () => {
    // Catches: a dropped null-key bucket, and L1 amounts multiplied through
    // the customers/L2 join (join-then-sum fan-out).
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);

    await attemptStable(async () => {
      const [kpis, ads] = await Promise.all([
        getOverviewKpis(admin, ls, "all"),
        getTopAds(admin, ls, "all"),
      ]);
      const l1 = ads.reduce((s, a) => s + a.l1_revenue_paise, 0);
      const l2 = ads.reduce((s, a) => s + a.l2_revenue_paise, 0);
      expect(l1).toBe(kpis.l1_revenue_paise);
      expect(l2).toBe(kpis.l2_revenue_paise);
    });
  });

  it("groups by ad_key, not ad_name — colliding names stay separate rows", async () => {
    // Catches: grouping by name, which would silently merge Love School's
    // top two ads (same ad_name, different ad ids — the exact collision the
    // campaign-scoped name rule exists for).
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const ads = await getTopAds(admin, ls, "all");
    const keysByName = new Map<string, Set<string>>();
    for (const a of ads) {
      if (a.ad_key == null || a.ad_name == null) continue;
      const set = keysByName.get(a.ad_name) ?? new Set();
      set.add(a.ad_key);
      keysByName.set(a.ad_name, set);
    }
    const collisions = [...keysByName.values()].filter((s) => s.size >= 2);
    expect(collisions.length).toBeGreaterThan(0);
  });
});

describe("overview RPCs — tenant scoping through the SDK", () => {
  it("returns zeros to a client identity asking about another tenant", async () => {
    // Catches: a function accidentally created `security definer`, which
    // would aggregate rows the caller's RLS forbids — a cross-tenant leak.
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const { data: own, error } = await client.from("clients").select("id");
    if (error) throw new Error(error.message);
    const ownIds = new Set((own ?? []).map((r) => r.id));
    const other = (await getClients(admin)).find((c) => !ownIds.has(c.id));
    if (!other) throw new Error("no second tenant available");

    const kpis = await getOverviewKpis(client, other.id, "all");
    expect(kpis.l1_revenue_paise).toBe(0);
    expect(kpis.l1_paid_count).toBe(0);
    expect(kpis.l2_revenue_paise).toBe(0);
    expect(kpis.sessions_count).toBe(0);
    expect(await getTopAds(client, other.id, "all")).toHaveLength(0);
    expect(await getRevenueDaily(client, other.id, "all")).toHaveLength(0);
  });

  it("denies the anon role execute on all three RPCs", async () => {
    // Catches: grants left open to anon (execute is revoked in the
    // migration; anon must error, not return zeros).
    const anon = anonClient();
    for (const fn of [
      "overview_kpis",
      "overview_revenue_daily",
      "overview_top_ads",
    ]) {
      const { error } = await anon.rpc(fn, {
        p_client_id: "00000000-0000-0000-0000-000000000000",
        p_days: null,
      });
      expect(error, `${fn} must not be callable as anon`).not.toBeNull();
    }
  });
});

describe("getClients", () => {
  it("selects only id and name — never api_key or encrypted secrets", async () => {
    // Catches: widening the select on `clients`, which carries api_key and
    // *_secret_enc ciphertext the dashboard must never touch.
    const admin = await adminClient();
    const clients = await getClients(admin);
    expect(clients.length).toBeGreaterThan(0);
    for (const c of clients) {
      expect(Object.keys(c).sort()).toEqual(["id", "name"]);
    }
  });
});

describe("rangeStartDay", () => {
  it("computes the inclusive window start, matching the SQL cutoff rule", () => {
    // Catches: an off-by-one that would chart 8 days for "7d" or drop
    // today — the SQL rule is today - (days - 1), inclusive of today.
    expect(rangeStartDay("7d", "2026-08-10")).toBe("2026-08-04");
    expect(rangeStartDay("30d", "2026-08-10")).toBe("2026-07-12");
  });

  it("crosses month boundaries correctly", () => {
    expect(rangeStartDay("7d", "2026-08-03")).toBe("2026-07-28");
  });

  it("returns null for all time — the caller uses the data's own bounds", () => {
    expect(rangeStartDay("all", "2026-08-10")).toBeNull();
  });
});

describe("fillDailyGaps", () => {
  const row = (day: string, l1 = 0, l2 = 0): RevenueDailyRow => ({
    day,
    l1_revenue_paise: l1,
    l2_revenue_paise: l2,
  });

  it("fills interior missing days with zero rows", () => {
    // Catches: a chart line that connects across missing days instead of
    // dipping to a truthful zero.
    const filled = fillDailyGaps(
      [row("2026-08-01", 100), row("2026-08-03", 300)],
      "2026-08-01",
      "2026-08-03"
    );
    expect(filled).toEqual([
      row("2026-08-01", 100),
      row("2026-08-02", 0, 0),
      row("2026-08-03", 300),
    ]);
  });

  it("extends to the requested bounds", () => {
    // Catches: an off-by-one dropping the final (today's) point.
    const filled = fillDailyGaps([row("2026-08-02", 50)], "2026-08-01", "2026-08-03");
    expect(filled.map((r) => r.day)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(filled[2]).toEqual(row("2026-08-03", 0, 0));
  });

  it("returns existing rows sorted when already continuous", () => {
    const filled = fillDailyGaps(
      [row("2026-08-02", 2), row("2026-08-01", 1)],
      "2026-08-01",
      "2026-08-02"
    );
    expect(filled.map((r) => r.day)).toEqual(["2026-08-01", "2026-08-02"]);
  });

  it("handles an empty range as all zeros", () => {
    const filled = fillDailyGaps([], "2026-08-01", "2026-08-02");
    expect(filled).toEqual([row("2026-08-01", 0, 0), row("2026-08-02", 0, 0)]);
  });
});

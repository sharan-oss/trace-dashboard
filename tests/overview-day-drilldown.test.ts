import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { presetState, parseDayParam } from "@/lib/range";
import { adminClient, clientClient } from "./helpers/supabase";
import {
  chartSpan,
  getClients,
  getDayPayments,
  getOverviewKpis,
  getRevenueDaily,
  istToday,
  rangeStartDay,
  type DayPaymentRow,
} from "@/lib/queries/overview";
import { getCustomersPage } from "@/lib/queries/customers";

/**
 * Tests for overview_day_payments — the Overview graph's day drill-down
 * (supabase/migrations/20260906090000_overview_day_payments.sql).
 *
 * The load-bearing property is RECONCILIATION: the function takes the same
 * window arguments as overview_revenue_daily and adds only `= p_day`, so its
 * rows must sum to that day's graph point exactly, in both modes, on every day.
 * If they ever don't, the sheet contradicts the point the user clicked.
 *
 * The second property is the opposite of a parity test: this drill-down is
 * SUPPOSED to disagree with Customers -> People, because People is scoped by
 * acquisition cohort. See "deliberately disagrees" below — that test is what
 * stops someone "fixing" the drill-down into the very bug it explains.
 *
 * Live DB: assert relationships, never absolute counts; rows arrive while the
 * suite runs, so cross-call reconciliations retry before failing.
 */

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

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

/** A client with L2 rows, and a window pair that actually contains some. */
async function splitFixture(admin: SupabaseClient) {
  const clients = await getClients(admin);
  for (const c of clients) {
    const all = await getRevenueDaily(admin, c.id, presetState("all"));
    const l2Days = all
      .filter((r) => r.l2_revenue_paise > 0)
      .map((r) => r.day)
      .sort();
    if (l2Days.length === 0) continue;
    return {
      clientId: c.id,
      l2From: l2Days[0],
      l2To: l2Days[l2Days.length - 1],
    };
  }
  return null;
}

const sumArm = (rows: DayPaymentRow[], arm: "l1" | "l2") =>
  rows.filter((r) => r.arm === arm).reduce((s, r) => s + r.amount, 0);

/** Every IST day in [from, to] inclusive — both YYYY-MM-DD. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe("overview_day_payments — reconciliation with the graph", () => {
  it("each day's rows sum to that day's overview_revenue_daily point, both arms", async () => {
    // THE contract. Catches any predicate drift from
    // 20260817090000_custom_windows_and_cohort_l2.sql — a different is_paid
    // rule, a lost dedupe guard, a UTC day slice instead of day_ist.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const state = presetState("30d");

    await attemptStable(async () => {
      const daily = await getRevenueDaily(admin, ls, state);
      expect(daily.length).toBeGreaterThan(0);
      for (const d of daily) {
        const rows = await getDayPayments(admin, ls, d.day, state);
        expect(sumArm(rows, "l1"), `${d.day} L1`).toBe(d.l1_revenue_paise);
        expect(sumArm(rows, "l2"), `${d.day} L2`).toBe(d.l2_revenue_paise);
      }
    });
  });

  it("reconciles in split mode too, including days outside the L2 window", async () => {
    // The case that proves the sheet cannot disagree with the clicked point
    // when a cohort L2 window is in play: on days outside it, both the graph
    // and the drill-down must read zero L2 rather than falling back to the
    // unfiltered set.
    const admin = await adminClient();
    const fx = await splitFixture(admin);
    if (fx == null) return;

    const state = {
      l1: { kind: "preset" as const, preset: "all" as const },
      l2: { from: fx.l2From, to: fx.l2To },
    };

    await attemptStable(async () => {
      const daily = await getRevenueDaily(admin, fx.clientId, state);
      const byDay = new Map(daily.map((r) => [r.day, r]));
      // Walk the chart's own span so days with no graph row are covered too.
      const span = chartSpan(state, istToday());
      const from = span.from ?? daily[0]?.day ?? span.to;
      for (const day of daysBetween(from, span.to)) {
        const rows = await getDayPayments(admin, fx.clientId, day, state);
        const point = byDay.get(day);
        expect(sumArm(rows, "l1"), `${day} L1`).toBe(point?.l1_revenue_paise ?? 0);
        expect(sumArm(rows, "l2"), `${day} L2`).toBe(point?.l2_revenue_paise ?? 0);
        if (day < fx.l2From || day > fx.l2To) {
          expect(rows.filter((r) => r.arm === "l2"), `${day} outside L2 window`)
            .toHaveLength(0);
        }
      }
    });
  });

  it("sums across every day to overview_kpis — no day is unreachable", async () => {
    // Catches a day the drill-down can never open even though it carries
    // revenue (e.g. an off-by-one at a window edge).
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const state = presetState("30d");

    await attemptStable(async () => {
      const [kpis, daily] = await Promise.all([
        getOverviewKpis(admin, ls, state),
        getRevenueDaily(admin, ls, state),
      ]);
      let l1 = 0;
      let l2 = 0;
      let l1Count = 0;
      let l2Count = 0;
      for (const d of daily) {
        const rows = await getDayPayments(admin, ls, d.day, state);
        l1 += sumArm(rows, "l1");
        l2 += sumArm(rows, "l2");
        l1Count += rows.filter((r) => r.arm === "l1").length;
        l2Count += rows.filter((r) => r.arm === "l2").length;
      }
      expect(l1).toBe(kpis.l1_revenue_paise);
      expect(l2).toBe(kpis.l2_revenue_paise);
      expect(l1Count).toBe(kpis.l1_paid_count);
      expect(l2Count).toBe(kpis.l2_count);
    });
  });
});

describe("overview_day_payments — predicates", () => {
  it("selects L1 by is_paid, not by status = 'paid'", async () => {
    // customer_payments_unified uses status='paid' and so drops the documented
    // rows that are paid with a null paid_at. The graph does not, and neither
    // may this. Pins that difference.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const state = presetState("30d");

    await attemptStable(async () => {
      const daily = await getRevenueDaily(admin, ls, state);
      const day = daily.filter((r) => r.l1_revenue_paise > 0).at(-1)?.day;
      if (day == null) return;

      const rows = await getDayPayments(admin, ls, day, state);
      const { data, error } = await admin
        .from("v_payments_attributed")
        .select("id")
        .eq("client_id", ls)
        .eq("is_paid", true)
        .eq("day_ist", day);
      if (error) throw new Error(error.message);

      expect(new Set(rows.filter((r) => r.arm === "l1").map((r) => r.row_id))).toEqual(
        new Set((data ?? []).map((r) => r.id)),
      );
    });
  });

  it("applies the L2 dedupe guard", async () => {
    // A no-op on live data today (no external_order_id matches a
    // payments.order_id), so the oracle recomputes the colliding set rather
    // than assuming it stays empty.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const state = presetState("all");

    await attemptStable(async () => {
      const { data: externals, error } = await admin
        .from("external_payments")
        .select("id, external_order_id")
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
      const excluded = new Set(
        (externals ?? [])
          .filter((r) => dupeSet.has(r.external_order_id))
          .map((r) => r.id),
      );

      const daily = await getRevenueDaily(admin, ls, state);
      for (const d of daily.filter((r) => r.l2_revenue_paise > 0)) {
        const rows = await getDayPayments(admin, ls, d.day, state);
        for (const row of rows.filter((r) => r.arm === "l2")) {
          expect(excluded.has(row.row_id), `${d.day} ${row.row_id}`).toBe(false);
        }
      }
    });
  });

  it("orders by arm, then amount descending", async () => {
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const state = presetState("30d");
    const daily = await getRevenueDaily(admin, ls, state);
    const day = daily.at(-1)?.day;
    if (day == null) return;

    const rows = await getDayPayments(admin, ls, day, state);
    expect(rows.every((r) => r.arm === "l1" || r.arm === "l2")).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      expect(prev.arm <= cur.arm).toBe(true);
      if (prev.arm === cur.arm) expect(prev.amount).toBeGreaterThanOrEqual(cur.amount);
    }
  });
});

describe("overview_day_payments — deliberately disagrees with Customers → People", () => {
  it("lists upsells by buyers acquired before the range, which People omits", async () => {
    // The reported symptom, asserted as intended behaviour: on 2026-09-06 six
    // upsells were paid but People (7d) showed four, because two buyers were
    // first acquired on 16 and 30 Aug. This is the inverse of the parity test
    // in customers-page.test.ts, and just as load-bearing — if someone
    // "fixes" the drill-down to use the cohort filter, this fails.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const state = presetState("7d");
    const fromDay = rangeStartDay("7d", istToday());
    if (fromDay == null) return;

    const daily = await getRevenueDaily(admin, ls, state);
    const stragglers: DayPaymentRow[] = [];
    for (const d of daily.filter((r) => r.l2_revenue_paise > 0)) {
      const rows = await getDayPayments(admin, ls, d.day, state);
      stragglers.push(
        ...rows.filter(
          (r) =>
            r.arm === "l2" &&
            r.customer_id != null &&
            r.acquired_day_ist != null &&
            r.acquired_day_ist < fromDay,
        ),
      );
    }
    // Data-dependent: skip cleanly in a week where every upseller is new.
    if (stragglers.length === 0) return;

    // Page through People so "absent" means absent, not merely off page 1.
    const present = new Set<string>();
    for (let page = 0; ; page++) {
      const { rows, total } = await getCustomersPage(admin, ls, "7d", {
        sort: "ltv",
        dir: "desc",
        repeatOnly: false,
        page,
      });
      for (const r of rows) present.add(r.customer_id);
      if (present.size >= total || rows.length === 0) break;
    }

    for (const s of stragglers) {
      expect(present.has(s.customer_id!), `${s.customer_email} acquired ${s.acquired_day_ist}`)
        .toBe(false);
    }
  });
});

describe("overview_day_payments — access control", () => {
  it("returns nothing for a tenant the caller cannot see", async () => {
    // Catches an accidental `security definer`, which would make the
    // p_client_id argument the only defense.
    const client = await clientClient();
    const rows = await getDayPayments(client, ZERO_UUID, istToday(), presetState("all"));
    expect(rows).toHaveLength(0);
  });

  it("denies anon", async () => {
    // Catches grants not issued against the new argument list.
    const anon = anonClient();
    const { error } = await anon.rpc("overview_day_payments", {
      p_client_id: ZERO_UUID,
      p_day: istToday(),
    });
    expect(error).not.toBeNull();
  });
});

describe("parseDayParam", () => {
  it("accepts a real IST calendar day", () => {
    expect(parseDayParam("2026-09-06")).toBe("2026-09-06");
    expect(parseDayParam(["2026-09-06", "2026-01-01"])).toBe("2026-09-06");
  });

  it("rejects to null rather than repairing", () => {
    // Same rule as the window bounds: a day the user did not choose is worse
    // than no day at all. Date.parse would roll 2026-02-31 into March.
    expect(parseDayParam("2026-02-31")).toBeNull();
    expect(parseDayParam("2026-9-6")).toBeNull();
    expect(parseDayParam("")).toBeNull();
    expect(parseDayParam(undefined)).toBeNull();
    expect(parseDayParam("yesterday")).toBeNull();
  });
});

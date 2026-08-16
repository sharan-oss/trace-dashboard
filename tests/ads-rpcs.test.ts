/**
 * Slice D aggregate RPCs, tested through the app's own query wrappers against
 * the live DB. Doctrine: relationships and invariants, never absolute counts —
 * rows arrive while the suite runs, so cross-source equalities retry a few
 * times before failing.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { presetState } from "@/lib/range";
import { adminClient, clientClient } from "./helpers/supabase";
import {
  getAdsBreakdown,
  getAdsSummary,
  getSpendDaily,
  type AdsBreakdownRow,
} from "@/lib/queries/ads";
import { getOverviewKpis } from "@/lib/queries/overview";

const OTHER_CLIENT = "00000000-0000-0000-0000-000000000000";

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

async function loveSchoolId() {
  const admin = await adminClient();
  const { data, error } = await admin.from("clients").select("id").eq("name", "Love School").single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function attemptStable(check: () => Promise<void>, attempts = 3): Promise<void> {
  for (let i = 1; ; i += 1) {
    try {
      await check();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
    }
  }
}

function tierSum(rows: AdsBreakdownRow[], tier: string, field: keyof AdsBreakdownRow): number {
  return rows.filter((r) => r.tier === tier).reduce((t, r) => t + Number(r[field]), 0);
}

describe("ads_breakdown — hierarchy invariants", () => {
  it("returns exactly the campaign and ad tiers (ad sets are demoted to labels)", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const rows = await getAdsBreakdown(admin, clientId, presetState("all"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tier === "campaign" || r.tier === "ad")).toBe(true);
  });

  it("spend, impressions and clicks totals agree across both tiers and with ads_summary", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [rows, summary] = await Promise.all([
        getAdsBreakdown(admin, clientId, presetState("all")),
        getAdsSummary(admin, clientId, presetState("all")),
      ]);
      for (const field of ["spend_paise", "impressions", "clicks"] as const) {
        expect(tierSum(rows, "campaign", field)).toBe(tierSum(rows, "ad", field));
      }
      const ad = tierSum(rows, "ad", "spend_paise");
      expect(summary.spend_paise).toBe(ad);
      expect(ad).toBeGreaterThan(0); // the backfill is live
      expect(rows.every((r) => r.impressions >= 0 && r.clicks >= 0)).toBe(true);
      // Meta has been delivering these ads, so the synced engagement must exist.
      expect(tierSum(rows, "ad", "impressions")).toBeGreaterThan(0);
    });
  });

  it("spend reconciles against a paged SDK oracle over ad_insights_daily", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const summary = await getAdsSummary(admin, clientId, presetState("all"));

      let oracle = 0;
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin
          .from("ad_insights_daily")
          .select("spend_minor")
          .eq("client_id", clientId)
          .order("id")
          .range(from, from + 999);
        expect(error).toBeNull();
        for (const r of data ?? []) oracle += Number(r.spend_minor);
        if (!data || data.length < 1000) break;
      }
      expect(summary.spend_paise).toBe(oracle);
    });
  });

  it("L1 revenue and sessions at every tier equal the overview KPI definitions", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [rows, kpis] = await Promise.all([
        getAdsBreakdown(admin, clientId, presetState("all")),
        getOverviewKpis(admin, clientId, presetState("all")),
      ]);
      for (const tier of ["campaign", "ad"]) {
        expect(tierSum(rows, tier, "l1_revenue_paise")).toBe(kpis.l1_revenue_paise);
        expect(tierSum(rows, tier, "l2_revenue_paise")).toBe(kpis.l2_revenue_paise);
        expect(tierSum(rows, tier, "sessions_count")).toBe(kpis.sessions_count);
      }
    });
  });

  it("returns the null-key Unattributed buckets rather than dropping them", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const rows = await getAdsBreakdown(admin, clientId, presetState("all"));
    // Love School provably has unattributed payments (Slice A finding), so the
    // null campaign bucket must exist and carry revenue.
    const nullCampaign = rows.find((r) => r.tier === "campaign" && r.campaign_key === null);
    expect(nullCampaign).toBeDefined();
    expect(nullCampaign!.l1_revenue_paise).toBeGreaterThan(0);
  });

  it("is range-monotonic: 7d ⊆ 30d ⊆ all for spend", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [s7, s30, sAll] = await Promise.all([
        getAdsSummary(admin, clientId, presetState("7d")),
        getAdsSummary(admin, clientId, presetState("30d")),
        getAdsSummary(admin, clientId, presetState("all")),
      ]);
      expect(s7.spend_paise).toBeLessThanOrEqual(s30.spend_paise);
      expect(s30.spend_paise).toBeLessThanOrEqual(sAll.spend_paise);
    });
  });
});

describe("ads_summary — reconciliation figures", () => {
  it("untracked spend and unattributed revenue never exceed their totals", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const [summary, kpis] = await Promise.all([
      getAdsSummary(admin, clientId, presetState("all")),
      getOverviewKpis(admin, clientId, presetState("all")),
    ]);
    expect(summary.spend_untracked_paise).toBeGreaterThanOrEqual(0);
    expect(summary.spend_untracked_paise).toBeLessThanOrEqual(summary.spend_paise);
    expect(summary.unattributed_l1_revenue_paise).toBeLessThanOrEqual(kpis.l1_revenue_paise);
  });
});

describe("overview_spend_daily", () => {
  it("daily rows sum to the summary spend and KPI paid count", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [daily, summary, kpis] = await Promise.all([
        getSpendDaily(admin, clientId, presetState("all")),
        getAdsSummary(admin, clientId, presetState("all")),
        getOverviewKpis(admin, clientId, presetState("all")),
      ]);
      const spendSum = daily.reduce((t, r) => t + Number(r.spend_paise), 0);
      const paidSum = daily.reduce((t, r) => t + Number(r.l1_paid_count), 0);
      expect(spendSum).toBe(summary.spend_paise);
      expect(paidSum).toBe(kpis.l1_paid_count);
    });
  });
});

describe("tenant scoping", () => {
  it("returns zeros/empty for a client id the caller cannot see", async () => {
    const client = await clientClient();
    const rows = await getAdsBreakdown(client, OTHER_CLIENT, presetState("all"));
    const summary = await getAdsSummary(client, OTHER_CLIENT, presetState("all"));
    expect(rows).toHaveLength(0);
    expect(summary.spend_paise).toBe(0);
    expect(summary.unattributed_l1_revenue_paise).toBe(0);
  });

  it("a scoped client sees exactly its own data, matching admin's view of it", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const client = await clientClient();
      const clientId = await loveSchoolId();
      const [viaAdmin, viaClient] = await Promise.all([
        getAdsSummary(admin, clientId, presetState("all")),
        getAdsSummary(client, clientId, presetState("all")),
      ]);
      expect(viaClient).toEqual(viaAdmin);
    });
  });

  it("refuses the anon role outright", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("ads_breakdown", {
      p_client_id: OTHER_CLIENT,
      p_days: null,
    });
    expect(error).not.toBeNull();
  });
});

/**
 * Custom windows and the cohort-scoped L2 window
 * (supabase/migrations/20260817090000_custom_windows_and_cohort_l2.sql).
 */
describe("ads RPCs — custom and split windows", () => {
  it("returns identical rows whether the new params are omitted or passed as null", async () => {
    // Catches a leftover (uuid, int) overload: PostgREST answers an ambiguous
    // call with PGRST203 instead of choosing.
    const admin = await adminClient();
    const clientId = await loveSchoolId();

    await attemptStable(async () => {
      for (const fn of ["ads_breakdown", "ads_summary", "overview_spend_daily"]) {
        const withL2 = fn === "ads_breakdown";
        const [old, explicit] = await Promise.all([
          admin.rpc(fn, { p_client_id: clientId, p_days: 30 }),
          admin.rpc(fn, {
            p_client_id: clientId,
            p_days: 30,
            p_from: null,
            p_to: null,
            ...(withL2 ? { p_l2_from: null, p_l2_to: null } : {}),
          }),
        ]);
        expect(old.error, `${fn} old call shape must still resolve`).toBeNull();
        expect(explicit.error).toBeNull();
        expect(explicit.data).toEqual(old.data);
      }
    });
  });

  it("keeps spend and L1 identical when only the L2 window is added", async () => {
    // Catches the L2 window leaking into the spend, L1 or sessions predicates
    // — the Ads page's ROAS denominator must not move when a client splits
    // the revenue window.
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const split = {
      l1: { kind: "preset", preset: "all" } as const,
      l2: { from: "2026-07-01", to: "2026-08-31" },
    };

    await attemptStable(async () => {
      const [plain, withSplit, plainSummary, splitSummary] = await Promise.all([
        getAdsBreakdown(admin, clientId, presetState("all")),
        getAdsBreakdown(admin, clientId, split),
        getAdsSummary(admin, clientId, presetState("all")),
        getAdsSummary(admin, clientId, split),
      ]);
      // ads_summary has no L2 arm at all, so it must be untouched.
      expect(splitSummary).toEqual(plainSummary);

      const key = (r: (typeof plain)[number]) =>
        `${r.tier}|${r.campaign_key}|${r.adset_key}|${r.ad_key}`;
      const splitByKey = new Map(withSplit.map((r) => [key(r), r]));
      for (const row of plain) {
        const other = splitByKey.get(key(row));
        if (other == null) continue;
        expect(other.spend_paise).toBe(row.spend_paise);
        expect(other.l1_revenue_paise).toBe(row.l1_revenue_paise);
        expect(other.sessions_count).toBe(row.sessions_count);
        // L2 can only shrink: cohort membership is an extra condition.
        expect(other.l2_revenue_paise).toBeLessThanOrEqual(row.l2_revenue_paise);
      }
    });
  });

  it("keeps the campaign and ad tiers reconciled in split mode", async () => {
    // Catches cohort membership applied at one grouping level but not the
    // other, which would make the campaigns table and the ad cards disagree.
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const split = {
      l1: { kind: "preset", preset: "all" } as const,
      l2: { from: "2026-07-01", to: "2026-08-31" },
    };

    await attemptStable(async () => {
      const [rows, kpis] = await Promise.all([
        getAdsBreakdown(admin, clientId, split),
        getOverviewKpis(admin, clientId, split),
      ]);
      const sumL2 = (tier: string) =>
        rows.filter((r) => r.tier === tier).reduce((t, r) => t + r.l2_revenue_paise, 0);
      expect(sumL2("campaign")).toBe(sumL2("ad"));
      expect(sumL2("campaign")).toBe(kpis.l2_revenue_paise);
    });
  });

  it("denies the anon role execute on the extended signatures", async () => {
    const anon = anonClient();
    const zero = "00000000-0000-0000-0000-000000000000";
    for (const [fn, args] of [
      ["ads_breakdown", { p_l2_from: "2026-08-15", p_l2_to: "2026-08-16" }],
      ["ads_summary", {}],
      ["overview_spend_daily", {}],
    ] as const) {
      const { error } = await anon.rpc(fn, {
        p_client_id: zero,
        p_days: null,
        p_from: null,
        p_to: null,
        ...args,
      });
      expect(error, `${fn} must not be callable as anon`).not.toBeNull();
    }
  });
});

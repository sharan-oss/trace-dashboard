/**
 * Slice D aggregate RPCs, tested through the app's own query wrappers against
 * the live DB. Doctrine: relationships and invariants, never absolute counts —
 * rows arrive while the suite runs, so cross-source equalities retry a few
 * times before failing.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
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
  it("spend totals agree across all three tiers and with ads_summary", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [rows, summary] = await Promise.all([
        getAdsBreakdown(admin, clientId, "all"),
        getAdsSummary(admin, clientId, "all"),
      ]);
      const campaign = tierSum(rows, "campaign", "spend_paise");
      const adset = tierSum(rows, "adset", "spend_paise");
      const ad = tierSum(rows, "ad", "spend_paise");
      expect(campaign).toBe(ad);
      expect(adset).toBe(ad);
      expect(summary.spend_paise).toBe(ad);
      expect(ad).toBeGreaterThan(0); // the backfill is live
    });
  });

  it("spend reconciles against a paged SDK oracle over ad_insights_daily", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const summary = await getAdsSummary(admin, clientId, "all");

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
        getAdsBreakdown(admin, clientId, "all"),
        getOverviewKpis(admin, clientId, "all"),
      ]);
      for (const tier of ["campaign", "adset", "ad"]) {
        expect(tierSum(rows, tier, "l1_revenue_paise")).toBe(kpis.l1_revenue_paise);
        expect(tierSum(rows, tier, "l2_revenue_paise")).toBe(kpis.l2_revenue_paise);
        expect(tierSum(rows, tier, "sessions_count")).toBe(kpis.sessions_count);
      }
    });
  });

  it("returns the null-key Unattributed buckets rather than dropping them", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const rows = await getAdsBreakdown(admin, clientId, "all");
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
        getAdsSummary(admin, clientId, "7d"),
        getAdsSummary(admin, clientId, "30d"),
        getAdsSummary(admin, clientId, "all"),
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
      getAdsSummary(admin, clientId, "all"),
      getOverviewKpis(admin, clientId, "all"),
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
        getSpendDaily(admin, clientId, "all"),
        getAdsSummary(admin, clientId, "all"),
        getOverviewKpis(admin, clientId, "all"),
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
    const rows = await getAdsBreakdown(client, OTHER_CLIENT, "all");
    const summary = await getAdsSummary(client, OTHER_CLIENT, "all");
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
        getAdsSummary(admin, clientId, "all"),
        getAdsSummary(client, clientId, "all"),
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

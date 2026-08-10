/**
 * The sync engine against the live database with a FAKE Meta client — never a
 * live Meta call in a test. Writes go through the real service identity and
 * RLS WITH CHECK path, using clearly-marked fixture rows:
 *
 *   - ad_accounts: meta_ad_account_id 'act_test_sync_fixture' (status
 *     'disconnected', kept permanently — the table deliberately has no delete)
 *   - ads: meta_ad_id 'test_sync_ad_%' (deleted in afterAll)
 *   - ad_insights_daily / ad_sync_runs rows for the fixture (deleted)
 *
 * The insight date is 2020-01-01 — far outside any live dashboard range.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSyncClient } from "@/lib/auth/service-identity";
import { runAdAccountSync, type SyncAccount } from "@/lib/meta/sync";
import type { MetaAd, MetaInsightRow } from "@/lib/meta/types";

const FIXTURE_ACT = "act_test_sync_fixture";
const DATE = "2020-01-01";

const AD_1: MetaAd = {
  id: "test_sync_ad_1",
  name: "Test Sync Ad One",
  status: "ACTIVE",
  effective_status: "ACTIVE",
  adset: { id: "test_sync_adset_1", name: "Test Sync Adset" },
  campaign: { id: "test_sync_campaign_1", name: "Test Sync Campaign" },
  creative: { id: "cr1", thumbnail_url: "https://example.invalid/t.png" },
};
const AD_2: MetaAd = {
  id: "test_sync_ad_2",
  name: "Test Sync Ad Two",
  status: "PAUSED",
  effective_status: "PAUSED",
  adset: { id: "test_sync_adset_1", name: "Test Sync Adset" },
  campaign: { id: "test_sync_campaign_1", name: "Test Sync Campaign" },
};

function insightRow(adId: string, spend: string): MetaInsightRow {
  return {
    ad_id: adId,
    date_start: DATE,
    date_stop: DATE,
    spend,
    impressions: "100",
    clicks: "5",
    reach: "80",
  };
}

function fakeMeta(ads: MetaAd[], insights: MetaInsightRow[]) {
  return {
    listAds: async () => ads,
    getAdInsights: async () => insights,
  };
}

let db: SupabaseClient;
let account: SyncAccount;

beforeAll(async () => {
  db = await createSyncClient();

  const { data: client, error: clientError } = await db
    .from("clients")
    .select("id, name")
    .eq("name", "Love School")
    .single();
  expect(clientError).toBeNull();

  const { data: fixture, error } = await db
    .from("ad_accounts")
    .upsert(
      {
        client_id: client!.id,
        meta_ad_account_id: FIXTURE_ACT,
        name: "TEST FIXTURE — sync tests, never a real account",
        currency: "INR",
        timezone_name: "Asia/Kolkata",
        status: "disconnected",
      },
      { onConflict: "meta_ad_account_id" }
    )
    .select("id, client_id, meta_ad_account_id, currency")
    .single();
  expect(error).toBeNull();
  account = fixture as SyncAccount;
});

afterAll(async () => {
  const { data: testAds } = await db
    .from("ads")
    .select("id")
    .like("meta_ad_id", "test_sync_ad_%");
  const ids = (testAds ?? []).map((r) => r.id);
  if (ids.length > 0) {
    await db.from("ad_insights_daily").delete().in("ad_id", ids);
    await db.from("ads").delete().in("id", ids);
  }
  await db.from("ad_sync_runs").delete().eq("ad_account_id", account.id);
});

describe("runAdAccountSync", () => {
  it("writes dimension, facts and a success run for one account-day", async () => {
    const result = await runAdAccountSync(
      { db, meta: fakeMeta([AD_1, AD_2], [insightRow("test_sync_ad_1", "12.34")]) },
      account,
      DATE,
      DATE
    );

    expect(result.conflict).toBeFalsy();
    if (result.conflict) return;
    expect(result.status).toBe("success");
    expect(result.adsSynced).toBe(2);
    expect(result.rowsUpserted).toBe(1);

    const { data: ad } = await db
      .from("ads")
      .select("ad_name, status, ad_account_id, last_synced_at")
      .eq("meta_ad_id", "test_sync_ad_1")
      .single();
    expect(ad?.ad_name).toBe("Test Sync Ad One");
    expect(ad?.status).toBe("active");
    expect(ad?.ad_account_id).toBe(account.id);
    expect(ad?.last_synced_at).toBeTruthy();

    const { data: fact } = await db
      .from("ad_insights_daily")
      .select("spend_minor, currency, impressions")
      .eq("date_start", DATE)
      .eq("client_id", account.client_id)
      .single();
    expect(fact?.spend_minor).toBe(1234);
    expect(fact?.currency).toBe("INR");
    expect(fact?.impressions).toBe(100);

    const { data: run } = await db
      .from("ad_sync_runs")
      .select("status, ads_synced, rows_upserted, finished_at")
      .eq("id", result.runId)
      .single();
    expect(run?.status).toBe("success");
    expect(run?.ads_synced).toBe(2);
    expect(run?.rows_upserted).toBe(1);
    expect(run?.finished_at).toBeTruthy();
  });

  it("writes one row per ad-day across a multi-day window", async () => {
    const day2 = "2020-01-02";
    const rows = [insightRow("test_sync_ad_1", "1.00"), { ...insightRow("test_sync_ad_2", "2.00"), date_start: day2, date_stop: day2 }];
    const result = await runAdAccountSync(
      { db, meta: fakeMeta([AD_1, AD_2], rows) },
      account,
      DATE,
      day2
    );
    expect(result.conflict).toBeFalsy();
    if (result.conflict) return;
    expect(result.rowsUpserted).toBe(2);

    const { data: run } = await db
      .from("ad_sync_runs")
      .select("date_from, date_to")
      .eq("id", result.runId)
      .single();
    expect(run?.date_from).toBe(DATE);
    expect(run?.date_to).toBe(day2);

    await db.from("ad_insights_daily").delete().eq("date_start", day2).eq("client_id", account.client_id);
  });

  it("marks ads absent from Meta's listing inactive, retaining the row", async () => {
    await runAdAccountSync({ db, meta: fakeMeta([AD_1, AD_2], []) }, account, DATE, DATE);
    await runAdAccountSync({ db, meta: fakeMeta([AD_1], []) }, account, DATE, DATE);

    const { data: gone } = await db.from("ads").select("status, ad_name").eq("meta_ad_id", "test_sync_ad_2").single();
    expect(gone?.status).toBe("inactive");
    expect(gone?.ad_name).toBe("Test Sync Ad Two"); // history retained

    const { data: kept } = await db.from("ads").select("status").eq("meta_ad_id", "test_sync_ad_1").single();
    expect(kept?.status).toBe("active");
  });

  it("is idempotent: the same window twice yields no duplicates and unchanged totals", async () => {
    const meta = fakeMeta([AD_1, AD_2], [insightRow("test_sync_ad_1", "12.34")]);
    await runAdAccountSync({ db, meta }, account, DATE, DATE);
    await runAdAccountSync({ db, meta }, account, DATE, DATE);

    const { data: facts } = await db
      .from("ad_insights_daily")
      .select("spend_minor")
      .eq("date_start", DATE)
      .eq("client_id", account.client_id);
    expect(facts).toHaveLength(1);
    expect(facts![0].spend_minor).toBe(1234);
  });

  it("marks the run partial when an insight row has no dimension row", async () => {
    const result = await runAdAccountSync(
      {
        db,
        meta: fakeMeta(
          [AD_1, AD_2],
          [insightRow("test_sync_ad_1", "1.00"), insightRow("test_sync_ad_unknown", "9.99")]
        ),
      },
      account,
      DATE,
      DATE
    );

    expect(result.conflict).toBeFalsy();
    if (result.conflict) return;
    expect(result.status).toBe("partial");
    expect(result.skippedInsightRows).toBe(1);
  });

  it("leaves a failed run row when Meta errors mid-run", async () => {
    const meta = {
      listAds: async () => [AD_1],
      getAdInsights: async (): Promise<MetaInsightRow[]> => {
        throw new Error("insights exploded");
      },
    };
    await expect(runAdAccountSync({ db, meta }, account, DATE, DATE)).rejects.toThrow("insights exploded");

    const { data: run } = await db
      .from("ad_sync_runs")
      .select("status, error")
      .eq("ad_account_id", account.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("insights exploded");
  });

  it("returns a conflict when a run is already in progress for the account", async () => {
    const { data: blocker } = await db
      .from("ad_sync_runs")
      .insert({ ad_account_id: account.id, client_id: account.client_id, kind: "manual", status: "running" })
      .select("id")
      .single();

    const result = await runAdAccountSync(
      { db, meta: fakeMeta([], []) },
      account,
      DATE,
      DATE
    );
    expect(result.conflict).toBe(true);

    await db.from("ad_sync_runs").delete().eq("id", blocker!.id);
  });
});

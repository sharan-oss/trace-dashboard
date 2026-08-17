/**
 * Nightly orchestration: window math, fixture exclusion, and per-account
 * failure isolation. Fake Meta, real database fixtures ('act_test_nightly_%',
 * excluded from production loading by loadActiveAccounts's act_test_% guard).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSyncClient } from "@/lib/auth/service-identity";
import { istDay, loadActiveAccounts, nightlyWindow, runNightlyForAccounts } from "@/lib/meta/nightly";
import type { SyncAccount } from "@/lib/meta/sync";
import type { MetaAd, MetaInsightRow } from "@/lib/meta/types";

let db: SupabaseClient;
const fixtures: SyncAccount[] = [];

beforeAll(async () => {
  db = await createSyncClient();
  const { data: client } = await db.from("clients").select("id").eq("name", "Love School").single();
  for (const suffix of ["1", "2"]) {
    const { data, error } = await db
      .from("ad_accounts")
      .upsert(
        {
          client_id: client!.id,
          meta_ad_account_id: `act_test_nightly_${suffix}`,
          name: `TEST FIXTURE — nightly ${suffix}`,
          currency: "INR",
          timezone_name: "Asia/Kolkata",
          status: "active",
        },
        { onConflict: "meta_ad_account_id" }
      )
      .select("id, client_id, meta_ad_account_id, currency")
      .single();
    expect(error).toBeNull();
    fixtures.push(data as SyncAccount);
  }
});

afterAll(async () => {
  for (const f of fixtures) {
    await db.from("ad_sync_runs").delete().eq("ad_account_id", f.id);
    await db.from("ad_accounts").update({ status: "disconnected" }).eq("id", f.id);
  }
});

describe("nightly window math", () => {
  it("spans the requested number of days ending today IST", () => {
    const { from, to } = nightlyWindow(28);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toBe(istDay(0));
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    expect(span).toBe(28);
  });

  // The window ended yesterday until 2026-08-17. Because the KPI RPCs leave
  // to_day unbounded on the preset path, revenue counted today while spend
  // could not — inflating every ROAS by a day's spend. This is the guard
  // against that behaviour creeping back.
  it("always includes today, so spend can never trail revenue by a day", () => {
    const { to } = nightlyWindow();
    expect(to).toBe(istDay(0));
  });
});

describe("loadActiveAccounts", () => {
  it("never returns test fixtures, even active ones", async () => {
    const accounts = await loadActiveAccounts(db);
    expect(accounts.every((a) => !a.meta_ad_account_id.startsWith("act_test_"))).toBe(true);
  });
});

describe("runNightlyForAccounts — failure isolation", () => {
  it("logs a failed run for a broken account and still syncs the next one", async () => {
    const meta = {
      listAds: async (adAccountId: string): Promise<MetaAd[]> => {
        if (adAccountId === "act_test_nightly_1") throw new Error("account one exploded");
        return [];
      },
      getAdInsights: async (): Promise<MetaInsightRow[]> => [],
      listAdImages: async () => [],
      listAdVideos: async () => [],
    };

    const outcomes = await runNightlyForAccounts({ db, meta }, fixtures, {
      from: "2020-01-01",
      to: "2020-01-02",
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ meta_ad_account_id: "act_test_nightly_1", outcome: "failed" });
    expect(outcomes[0].detail).toContain("account one exploded");
    expect(outcomes[1]).toMatchObject({ meta_ad_account_id: "act_test_nightly_2", outcome: "success" });

    const { data: failedRun } = await db
      .from("ad_sync_runs")
      .select("status, kind, error")
      .eq("ad_account_id", fixtures[0].id)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.kind).toBe("nightly");
  });
});

/**
 * The sync engine: one ad account, one Asia/Kolkata day.
 *
 * Upserts ad metadata into `ads` on meta_ad_id (adopting the hand-seeded Love
 * School rows — refreshing names and status, filling ad_account_id, setting
 * last_synced_at) and daily insights into ad_insights_daily on
 * (ad_id, date_start), with every run logged in ad_sync_runs transitioning
 * running → success | partial | failed. The unique keys make the whole thing
 * idempotent: re-running any window is always safe.
 *
 * Meta client and database are injected so tests run with a fake Meta and the
 * real RLS path — never a live Meta call in a test.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaClient } from "@/lib/meta/client";
import { toMinorUnits } from "@/lib/meta/money";
import { mirrorThumbnails } from "@/lib/meta/thumbnails";
import type { MetaAd } from "@/lib/meta/types";

export type SyncAccount = {
  /** ad_accounts.id (uuid), not the Meta act_ id. */
  id: string;
  client_id: string;
  meta_ad_account_id: string;
  currency: string;
};

export type SyncResult =
  | { conflict: true; runningRunId: string }
  | {
      conflict?: false;
      runId: string;
      status: "success" | "partial";
      adsSynced: number;
      rowsUpserted: number;
      skippedInsightRows: number;
      thumbnailsMirrored: number;
      thumbnailsFailed: number;
      apiCalls: number;
    };

export type SyncDeps = {
  db: SupabaseClient;
  meta: Pick<MetaClient, "listAds" | "getAdInsights">;
  /** Reads the running HTTP-request count (wired to the client's onRequest). */
  apiCallCount?: () => number;
  /** When set, mirror creative thumbnails as part of the run (AC-11). Omit to
   * skip — e.g. unit tests that only exercise the spend path. */
  thumbnails?: { limit?: number; fetchImpl?: typeof fetch };
};

function usableAd(ad: MetaAd): ad is MetaAd & {
  adset: { id: string; name: string };
  campaign: { id: string; name: string };
} {
  return Boolean(ad.id && ad.name && ad.adset?.id && ad.adset.name && ad.campaign?.id && ad.campaign.name);
}

export async function runAdAccountSync(
  deps: SyncDeps,
  account: SyncAccount,
  dateFrom: string,
  dateTo: string,
  kind: "manual" | "nightly" | "backfill" = "manual"
): Promise<SyncResult> {
  const { db, meta } = deps;
  const apiCalls = deps.apiCallCount ?? (() => 0);

  // One run at a time per account. Not a transaction — the unique keys make a
  // lost race merely redundant, not corrupting.
  const { data: running } = await db
    .from("ad_sync_runs")
    .select("id")
    .eq("ad_account_id", account.id)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (running) {
    return { conflict: true, runningRunId: running.id };
  }

  const { data: run, error: runError } = await db
    .from("ad_sync_runs")
    .insert({
      client_id: account.client_id,
      ad_account_id: account.id,
      kind,
      status: "running",
      date_from: dateFrom,
      date_to: dateTo,
    })
    .select("id")
    .single();
  if (runError || !run) {
    throw new Error(`could not open ad_sync_runs row: ${runError?.message}`);
  }

  try {
    const now = new Date().toISOString();

    // 1. Dimension: adopt/refresh every ad the account has.
    const ads = await meta.listAds(account.meta_ad_account_id);
    const usable = ads.filter(usableAd);
    if (usable.length > 0) {
      const { error } = await db.from("ads").upsert(
        usable.map((ad) => ({
          client_id: account.client_id,
          ad_account_id: account.id,
          meta_ad_id: ad.id,
          meta_adset_id: ad.adset.id,
          meta_campaign_id: ad.campaign.id,
          ad_name: ad.name,
          adset_name: ad.adset.name,
          campaign_name: ad.campaign.name,
          // Meta's effective_status (what is actually happening) over status
          // (what the advertiser set), lowercased verbatim — no invented enum.
          status: (ad.effective_status ?? ad.status).toLowerCase(),
          creative_source_url: ad.creative?.image_url ?? ad.creative?.thumbnail_url ?? null,
          last_synced_at: now,
        })),
        { onConflict: "meta_ad_id" }
      );
      if (error) throw new Error(`ads upsert failed: ${error.message}`);

      // Lifecycle (AC-12): anything of this account Meta no longer lists —
      // stamp is older than this run, or the row was seeded and never synced —
      // goes inactive. Never deleted: names keep resolving, history is
      // untouched. Guarded on a non-empty listing so a fluke empty response
      // can never mass-retire an account.
      const { error: retireError } = await db
        .from("ads")
        .update({ status: "inactive" })
        .eq("ad_account_id", account.id)
        .or(`last_synced_at.lt.${now},last_synced_at.is.null`);
      if (retireError) throw new Error(`inactive marking failed: ${retireError.message}`);
    }

    // 2. Resolve meta_ad_id → ads.id for the insights foreign key. Paged:
    //    PostgREST caps un-ranged selects at 1000 rows, and Love School alone
    //    has more ads than that — an unpaged readback silently orphaned
    //    insight rows on the first live backfill.
    const adIdByMetaId = new Map<string, string>();
    const readDimension = async () => {
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const { data: page, error: dimError } = await db
          .from("ads")
          .select("id, meta_ad_id")
          .eq("client_id", account.client_id)
          .order("id")
          .range(offset, offset + PAGE - 1);
        if (dimError) throw new Error(`ads readback failed: ${dimError.message}`);
        for (const r of page ?? []) adIdByMetaId.set(r.meta_ad_id as string, r.id as string);
        if (!page || page.length < PAGE) break;
      }
    };
    await readDimension();

    // 3. Facts: one row per ad for the day. Insights come back in the ad
    //    account's own timezone; every mapped account is Asia/Kolkata (the
    //    POST /accounts INR guard keeps it that way), so date_start is already
    //    the IST day and is stored as-is.
    const insights = await meta.getAdInsights(account.meta_ad_account_id, dateFrom, dateTo);

    // 3a. Deleted ads: Meta reports their spend history but refuses to list
    //     them via /ads (code 100/1815001), so they can never arrive through
    //     the dimension sync. Synthesize inactive dimension rows from the
    //     insight rows' own hierarchy fields — spend is never orphaned.
    const unknown = insights.filter(
      (row) => !adIdByMetaId.has(row.ad_id) && row.ad_name && row.adset_id && row.campaign_id
    );
    if (unknown.length > 0) {
      const stubByAdId = new Map(unknown.map((row) => [row.ad_id, row]));
      const { error: stubError } = await db.from("ads").upsert(
        [...stubByAdId.values()].map((row) => ({
          client_id: account.client_id,
          ad_account_id: account.id,
          meta_ad_id: row.ad_id,
          meta_adset_id: row.adset_id!,
          meta_campaign_id: row.campaign_id!,
          ad_name: row.ad_name!,
          adset_name: row.adset_name ?? row.adset_id!,
          campaign_name: row.campaign_name ?? row.campaign_id!,
          status: "inactive",
          last_synced_at: now,
        })),
        { onConflict: "meta_ad_id" }
      );
      if (stubError) throw new Error(`deleted-ad stub upsert failed: ${stubError.message}`);
      await readDimension();
    }

    let skipped = 0;
    const factRows = [];
    for (const row of insights) {
      const adId = adIdByMetaId.get(row.ad_id);
      if (!adId) {
        skipped += 1;
        continue;
      }
      factRows.push({
        client_id: account.client_id,
        ad_id: adId,
        date_start: row.date_start,
        spend_minor: toMinorUnits(row.spend ?? "0", account.currency),
        currency: account.currency,
        impressions: Number.parseInt(row.impressions ?? "0", 10),
        clicks: Number.parseInt(row.clicks ?? "0", 10),
        reach: Number.parseInt(row.reach ?? "0", 10),
        raw: row,
        synced_at: now,
      });
    }
    if (factRows.length > 0) {
      const { error } = await db
        .from("ad_insights_daily")
        .upsert(factRows, { onConflict: "ad_id,date_start" });
      if (error) throw new Error(`ad_insights_daily upsert failed: ${error.message}`);
    }

    // 4. Creative thumbnails (AC-11) — failures degrade, never abort.
    let thumbs = { mirrored: 0, failed: 0 };
    if (deps.thumbnails) {
      thumbs = await mirrorThumbnails({
        db,
        accountId: account.id,
        limit: deps.thumbnails.limit,
        fetchImpl: deps.thumbnails.fetchImpl,
      });
    }

    const problems = [
      skipped > 0 ? `${skipped} insight rows had no dimension row` : null,
      thumbs.failed > 0 ? `${thumbs.failed} thumbnails failed to mirror` : null,
    ].filter(Boolean);
    const status = problems.length > 0 ? "partial" : "success";
    await db
      .from("ad_sync_runs")
      .update({
        status,
        ads_synced: usable.length,
        rows_upserted: factRows.length,
        api_calls: apiCalls(),
        error: problems.length > 0 ? problems.join("; ") : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return {
      runId: run.id,
      status,
      adsSynced: usable.length,
      rowsUpserted: factRows.length,
      skippedInsightRows: skipped,
      thumbnailsMirrored: thumbs.mirrored,
      thumbnailsFailed: thumbs.failed,
      apiCalls: apiCalls(),
    };
  } catch (err) {
    await db
      .from("ad_sync_runs")
      .update({
        status: "failed",
        api_calls: apiCalls(),
        error: (err as Error).message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw err;
  }
}

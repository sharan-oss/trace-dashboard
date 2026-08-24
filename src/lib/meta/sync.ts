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
import { assertBudget } from "@/lib/meta/deadline";
import { toMinorUnits } from "@/lib/meta/money";
import { mirrorThumbnails } from "@/lib/meta/thumbnails";
import type { MetaAd, MetaAdVideo } from "@/lib/meta/types";

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
  meta: Pick<MetaClient, "listAds" | "getAdInsights" | "listAdImages" | "listAdVideos">;
  /** Reads the running HTTP-request count (wired to the client's onRequest). */
  apiCallCount?: () => number;
  /** When set, mirror creative thumbnails as part of the run (AC-11). Omit to
   * skip — e.g. unit tests that only exercise the spend path. */
  thumbnails?: { limit?: number; fetchImpl?: typeof fetch };
  /** Epoch-ms invocation budget. Checked at every phase boundary so the run
   * aborts (and closes its own row) instead of being killed by the platform
   * mid-phase. The Meta client should carry the same deadline for its sleeps. */
  deadlineAt?: number;
};

/**
 * The poster hash, wherever Meta happened to put it. Classic ads carry it on
 * the creative or in object_story_spec; Advantage+/dynamic ads populate only
 * asset_feed_spec and leave the rest null. Checking one place silently loses
 * whole creative types.
 */
function imageHashOf(ad: MetaAd): string | undefined {
  const c = ad.creative;
  return (
    c?.image_hash ??
    c?.object_story_spec?.video_data?.image_hash ??
    c?.object_story_spec?.link_data?.image_hash ??
    c?.object_story_spec?.photo_data?.image_hash ??
    c?.asset_feed_spec?.images?.find((i) => i.hash)?.hash ??
    c?.asset_feed_spec?.videos?.find((v) => v.thumbnail_hash)?.thumbnail_hash
  );
}

function videoIdOf(ad: MetaAd): string | undefined {
  const c = ad.creative;
  return (
    c?.video_id ??
    c?.object_story_spec?.video_data?.video_id ??
    c?.asset_feed_spec?.videos?.find((v) => v.video_id)?.video_id
  );
}

/** A creative url already present on the ad, needing no catalog lookup. */
function inlineUrlOf(ad: MetaAd): string | undefined {
  const c = ad.creative;
  return (
    c?.image_url ??
    c?.object_story_spec?.video_data?.image_url ??
    c?.object_story_spec?.link_data?.picture ??
    c?.asset_feed_spec?.videos?.find((v) => v.thumbnail_url)?.thumbnail_url ??
    c?.asset_feed_spec?.images?.find((i) => i.url)?.url
  );
}

/** Poster frame for a video, preferring a real extracted frame over `picture`,
 * which can be Meta's grey "still processing" placeholder. Picks the smallest
 * rung at or above card size so we never mirror a 64px blur. */
function posterOf(video: MetaAdVideo): string | undefined {
  const preferred = video.thumbnails?.data?.find((t) => t.is_preferred)?.uri;
  const anyFrame = video.thumbnails?.data?.find((t) => t.uri)?.uri;
  const ladder = (video.format ?? [])
    .filter((f) => f.picture != null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const rung = ladder.find((f) => (f.width ?? 0) >= 320) ?? ladder.at(-1);
  return preferred ?? anyFrame ?? rung?.picture ?? video.picture;
}

function usableAd(ad: MetaAd): ad is MetaAd & {
  adset: { id: string; name: string };
  campaign: { id: string; name: string };
} {
  return Boolean(ad.id && ad.name && ad.adset?.id && ad.adset.name && ad.campaign?.id && ad.campaign.name);
}

/**
 * How stale the dimension may get before a full walk is forced. Incremental
 * walks cannot see deletions — Meta simply stops mentioning a removed ad — so
 * retirement would never fire without periodically re-listing everything.
 */
const FULL_WALK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A 'running' row older than this is an orphan, not a run. A Vercel timeout
 * kills the process outright — no cleanup hook — so the catch below that
 * closes the row as 'failed' never fires, and without an age bound the
 * conflict check would 409 the account forever (this wedged Occultyogis on
 * 2026-08-16). Every legal invocation is capped at maxDuration = 300s, so ten
 * minutes cannot be a live run.
 */
export const STALE_RUN_MAX_AGE_MS = 10 * 60 * 1000;

/** Newest last_synced_at for this account, or null if we hold no ads yet. */
async function lastDimensionSync(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data } = await db
    .from("ads")
    .select("last_synced_at")
    .eq("ad_account_id", accountId)
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.last_synced_at as string | undefined) ?? null;
}

export async function runAdAccountSync(
  deps: SyncDeps,
  account: SyncAccount,
  dateFrom: string,
  dateTo: string,
  kind: "manual" | "nightly" | "backfill" = "manual",
  forceFullWalk = false
): Promise<SyncResult> {
  const { db, meta } = deps;
  const apiCalls = deps.apiCallCount ?? (() => 0);

  // A 'running' row past the lease age is a killed process, not a run: close
  // any such orphans first, so one timeout can never wedge the account
  // permanently. All of them, not just the newest — wedges can accumulate.
  await db
    .from("ad_sync_runs")
    .update({
      status: "failed",
      error: "abandoned: the process was killed before it could close this run",
      finished_at: new Date().toISOString(),
    })
    .eq("ad_account_id", account.id)
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - STALE_RUN_MAX_AGE_MS).toISOString());

  // One run at a time per account, enforced by the DB: the partial unique
  // index ad_sync_runs_one_running_per_account rejects a second 'running' row
  // outright, so the claim is the insert itself — no SELECT-then-INSERT race
  // between Sync-now and the cron. A lost race surfaces as 23505 and is
  // reported as a conflict, never a duplicate run.
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
    if (runError?.code === "23505") {
      const { data: running } = await db
        .from("ad_sync_runs")
        .select("id")
        .eq("ad_account_id", account.id)
        .eq("status", "running")
        .limit(1)
        .maybeSingle();
      return { conflict: true, runningRunId: running?.id ?? "unknown" };
    }
    throw new Error(`could not open ad_sync_runs row: ${runError?.message}`);
  }

  try {
    const now = new Date().toISOString();
    let creativeFailures = 0;

    // 1. Dimension: adopt/refresh the account's ads. Incremental whenever we
    //    already hold rows for this account — a full walk costs ~6 API calls
    //    on a large account and the dev tier only affords 60 per 5 minutes,
    //    so re-listing 2,540 unchanged ads every run is budget we need for
    //    the spend data. A full walk still happens the first time, and
    //    whenever the caller forces one.
    assertBudget(deps.deadlineAt);
    const newest = forceFullWalk ? null : await lastDimensionSync(db, account.id);
    // Full walk when we hold nothing, when forced, or once a week so deletions
    // are eventually noticed; incremental the rest of the time.
    const stale =
      newest != null && Date.now() - new Date(newest).getTime() > FULL_WALK_MAX_AGE_MS;
    const since = stale ? null : newest;
    const ads = await meta.listAds(
      account.meta_ad_account_id,
      since == null ? undefined : Math.floor(new Date(since).getTime() / 1000)
    );
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
          meta_creative_id: ad.creative?.id ?? null,
          meta_image_hash: imageHashOf(ad) ?? null,
          meta_video_id: videoIdOf(ad) ?? null,
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
      // Only ever on a FULL walk: after an incremental one, "not re-listed"
      // means "unchanged", and retiring on that would mark the whole account
      // inactive on the first quiet night.
      if (since == null) {
        const { error: retireError } = await db
          .from("ads")
          .update({ status: "inactive" })
          .eq("ad_account_id", account.id)
          .or(`last_synced_at.lt.${now},last_synced_at.is.null`);
        if (retireError) throw new Error(`inactive marking failed: ${retireError.message}`);
      }
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
    assertBudget(deps.deadlineAt);
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

    // 3b. Creative source urls, resolved from the ACCOUNT'S ASSET CATALOGS
    //     rather than by asking Meta to render a thumbnail per ad.
    //
    //     The identifiers were already stored above for free — they ride along
    //     as plain JSON on the creative. Here two bulk edge reads turn them
    //     into urls: /adimages gives a documented-PERMANENT permalink_url, and
    //     /advideos gives a poster-frame ladder we pick a card-sized rung from.
    //     Both are account-scoped, so they cost the same for 2,540 ads as for
    //     25,000 — where the old per-ad render walk cost ~102 calls and blew
    //     the tier's whole budget.
    //
    //     Still last, and still non-fatal: a catalog read that fails costs
    //     pictures, never the spend data already written above.
    if (deps.thumbnails) {
      try {
        assertBudget(deps.deadlineAt);
        const pending: { meta_ad_id: string; meta_image_hash: string | null; meta_video_id: string | null }[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          // Paged: PostgREST caps ANY select at 1000 rows, `.limit(5000)`
          // included, so an unpaged read silently covers a third of a large
          // account and calls it done.
          const { data, error: pendingError } = await db
            .from("ads")
            .select("meta_ad_id, meta_image_hash, meta_video_id")
            .eq("ad_account_id", account.id)
            .is("creative_source_url", null)
            .order("meta_ad_id")
            .range(from, from + PAGE - 1);
          if (pendingError) throw new Error(pendingError.message);
          pending.push(...((data ?? []) as typeof pending));
          if (!data || data.length < PAGE) break;
        }

        if (pending.length > 0) {
          // Deduped: an account reuses one asset across many ads, so the
          // catalogs we fetch are far smaller than the ad count.
          const hashes = [...new Set(pending.map((p) => p.meta_image_hash).filter((h): h is string => h != null))];
          const videoIds = [...new Set(pending.map((p) => p.meta_video_id).filter((v): v is string => v != null))];

          const [images, videos] = await Promise.all([
            hashes.length > 0 ? meta.listAdImages(account.meta_ad_account_id) : Promise.resolve([]),
            videoIds.length > 0 ? meta.listAdVideos(account.meta_ad_account_id) : Promise.resolve([]),
          ]);

          const urlByHash = new Map(
            images
              .filter((i) => i.hash != null)
              // permalink_url first: `url` is documented "temporary".
              .map((i) => [i.hash, i.permalink_url ?? i.url])
              .filter((e): e is [string, string] => e[1] != null)
          );
          const posterByVideo = new Map(
            videos
              .map((v: MetaAdVideo) => [v.id, posterOf(v)] as const)
              .filter((e): e is [string, string] => e[1] != null)
          );

          const inlineByAd = new Map(
            usable.map((ad) => [ad.id, inlineUrlOf(ad)] as const).filter((e) => e[1] != null)
          );

          const updates = pending
            .map((row) => {
              const url =
                (row.meta_image_hash != null ? urlByHash.get(row.meta_image_hash) : undefined) ??
                (row.meta_video_id != null ? posterByVideo.get(row.meta_video_id) : undefined) ??
                inlineByAd.get(row.meta_ad_id);
              return url == null ? null : { meta_ad_id: row.meta_ad_id, creative_source_url: url };
            })
            .filter((u): u is { meta_ad_id: string; creative_source_url: string } => u != null);

          if (updates.length > 0) {
            const { error: creativeError } = await db.from("ads").upsert(
              updates.map((u) => ({
                client_id: account.client_id,
                ad_account_id: account.id,
                meta_ad_id: u.meta_ad_id,
                creative_source_url: u.creative_source_url,
              })),
              { onConflict: "meta_ad_id" }
            );
            if (creativeError) creativeFailures = updates.length;
          }
          creativeFailures += pending.length - updates.length;
        }
      } catch {
        creativeFailures += 1;
      }
    }

    // 4. Creative thumbnails (AC-11) — failures degrade, never abort.
    let thumbs = { mirrored: 0, failed: 0 };
    if (deps.thumbnails) {
      thumbs = await mirrorThumbnails({
        db,
        accountId: account.id,
        limit: deps.thumbnails.limit,
        fetchImpl: deps.thumbnails.fetchImpl,
        deadlineAt: deps.deadlineAt,
      });
    }

    const problems = [
      skipped > 0 ? `${skipped} insight rows had no dimension row` : null,
      thumbs.failed > 0 ? `${thumbs.failed} thumbnails failed to mirror` : null,
      creativeFailures > 0 ? `${creativeFailures} creative urls unresolved` : null,
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
      .eq("id", run.id)
      // Zombie guard: if the stale-run lease already closed this row (this
      // invocation outlived its lease), leave that verdict alone.
      .eq("status", "running");

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
      .eq("id", run.id)
      .eq("status", "running");
    throw err;
  }
}

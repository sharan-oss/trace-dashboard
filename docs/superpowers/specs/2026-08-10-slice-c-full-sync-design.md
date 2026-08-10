# Slice C — Full Meta Sync: backfill, nightly cron, thumbnails, lifecycle

Approved by Sharan 2026-08-10 (chat). Child of
`docs/superpowers/specs/2026-08-09-meta-ads-attribution/02-meta-ads-sync.md`;
where this document and that spec disagree, this one wins — each deviation is
justified by live evidence gathered after the spec was written (the access
probe and Slice B's first live sync, see STATUS.md).

**Goal.** Slice B synced one account for one day, manually. Slice C makes the
sync self-sustaining: all history since Trace's first session (2026-06-27)
lands in `ad_insights_daily`, every night updates it automatically, creative
thumbnails render forever, and retired ads are marked without losing history.
Covers AC-9 (backfill + nightly), AC-11 (creative mirroring), AC-12 (inactive
marking), AC-13 (every attempt logged). After this slice, the Ads UI (Slice D)
is purely a read problem.

## Deviations from the 2026-08-09 spec, with reasons

| Spec said | Slice C does | Why |
|---|---|---|
| Async report jobs + two-step submit/poll + 3h stale cutoff | **Synchronous insights calls everywhere** | Live evidence: a full day is 1–2 calls, only ~5 ads deliver at once; a month chunk is seconds. Meta's own guidance is sync-first. Async remains the documented fallback if a chunk ever times out. Approved by Sharan 2026-08-10. |
| Nightly rolling 7-day window | **Trailing 28-day window** | Meta's stated mutation horizon is 28 days; the cost difference is 1–2 calls per account; future-proofs conversion fields. |
| `sync_runs` | `ad_sync_runs` | Name collision (see STATUS.md). |
| Token in Supabase Vault | Server-only env var | Decided in the Slice B plan (Vault would be PostgREST-reachable via SECURITY DEFINER). |

## Components

### 1. Range insights
- `getAdInsights(adAccountId, since, until)` — range `time_range`, still
  `level=ad`, `time_increment=1`, paginated.
- `runAdAccountSync(deps, account, dateFrom, dateTo, kind)` — syncs a window;
  run rows' `date_from`/`date_to` now differ. Idempotency (upsert on
  `(ad_id, date_start)`) makes window overlaps safe.

### 2. Ad lifecycle: absent ⇒ inactive (AC-12)
Every run stamps `last_synced_at = runStart` on ads Meta returned; afterwards
`ads` rows of that account with an older stamp are set `status='inactive'`.
Never deleted — names keep resolving, history never changes.

### 3. Creative thumbnails (AC-11)
- Migration creates private Storage bucket **`ad-creatives`** with
  `storage.objects` policies: insert/update/delete `is_admin` only; select
  `is_admin` OR top-level folder = caller's `client_id` claim. Object path
  `{client_id}/{meta_ad_id}.jpg` — tenant separation is structural, Slice D's
  signed URLs inherit it.
- During each run, ads with `creative_source_url` but no
  `creative_thumbnail_path` (or a changed source URL) get downloaded and
  mirrored; path saved on the row. Meta's own URLs are signed and expire —
  mirroring is the only stable render.
- Cap 150 mirrors per nightly run (Hobby 300s ceiling; converges). The
  backfill script mirrors uncapped. Thumbnail failures downgrade the run to
  `partial`, never abort it — spend matters more than pictures.

### 4. Nightly cron
- `vercel.json`: `{"crons":[{"path":"/api/ads/sync","schedule":"0 21 * * *"}]}`
  — 21:00 UTC = 2:30 AM IST, after the IST day closes. Fits Hobby (daily,
  hour granularity, 300s).
- **GET /api/ads/sync** = orchestrator (Vercel crons send GET with
  `Authorization: Bearer $CRON_SECRET` once the env var exists): every
  `status='active'` account, sequentially — dimension refresh, inactive
  marking, trailing 28-day window, capped thumbnails — one `kind='nightly'`
  run row per account; one account's failure logs `failed` and continues.
- **POST /api/ads/sync** stays manual/targeted, now `date_from`/`date_to`
  (single `date` still accepted).
- New env `CRON_SECRET` — required in Vercel before the cron fires.

### 5. Backfill (AC-9)
`scripts/backfill-ads.ts`, run locally with tsx (no serverless limits): per
active account, one uncapped dimension+thumbnail sync, then month chunks from
2026-06-27 to yesterday, one `kind='backfill'` run row per chunk.
**Resumable**: a chunk with an existing `success` backfill row for that
account+window is skipped — a crashed backfill resumes; a zero-spend month
keeps its `success` row and is never re-fetched.

## Security posture (unchanged from Slice B)
Publishable key + RLS everywhere; writes via the `ads-sync` identity through
WITH CHECK policies; secrets in server-only env; private bucket with
claim-scoped read; no live Meta call in any test.

## Out of scope
Ads UI and signed-URL serving (Slice D); spend on the Overview (Slice D
labels: "Meta spend", never "total spend"); multi-currency; the async
fallback; alerting for silently-failing nightly runs (known gap — Slice D's
stale-notice is the mitigation; note in STATUS.md).

## Build order
1. This document.
2. Client range + engine window (TDD).
3. Inactive marking (TDD).
4. Storage migration + thumbnail mirroring (TDD).
5. GET orchestrator + POST range + vercel.json + CRON_SECRET (TDD).
6. Backfill script → live backfill → paise-exact reconciliation vs Meta.
7. STATUS.md, full suite, merge decision.

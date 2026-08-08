# Meta Ads Attribution and Spend Integration

**Date**: 2026-08-09
**Status**: Proposed

## Summary

This decision covers how the dashboard turns raw payment and session data into trustworthy ad performance numbers, and how it pulls spend and creative images from Meta so you can see return on ad spend (ROAS, revenue divided by spend) and cost per acquisition (CPA, spend divided by conversions).

It splits into three parts you can build independently. The first fixes the meaning of the numbers you already have (which rows are tests, which conversion rate is which, and how to identify an ad when every client tags differently). It needs no Meta access at all, so it unblocks Phase 1 immediately. The second adds a nightly job that pulls spend from Meta into four new tables. The third builds the Ads section of the dashboard on top of both.

The load bearing choice is that Trace's own payment records are the single source of truth for revenue. Meta supplies spend and creative images only, never conversion counts. That means the dashboard never shows two conflicting revenue numbers on one screen.

## Structure

| Child spec | What it is | Which decision it supports |
|---|---|---|
| [01-metrics-foundation.md](01-metrics-foundation.md) | Read layer views over existing tables: UTM normalization, Test marking, the two conversion rates, and the canonical ad key | Makes existing data trustworthy. No Meta dependency, buildable now |
| [02-meta-ads-sync.md](02-meta-ads-sync.md) | Four new tables, the Meta API client, the nightly sync and backfill, creative mirroring | Brings spend and creative images into the database |
| [03-ads-ui.md](03-ads-ui.md) | The Ads section: campaign to ad set to ad drill down, ROAS and CPA, reconciliation rows | Presents the joined result to admin and clients |
| [04-utm-template-standard.md](04-utm-template-standard.md) | The one Ads Manager URL template for every client, the ban on `&` in Meta names, and the manual export seed path | Makes future data arrive clean at the source, so the read layer stops repairing |

Reasoning and options: see [rationale.md](rationale.md).

## Cross child contract

These three points bind the children together. Change one and all three specs need revisiting.

1. **The join has three tiers, all produced by child 01 and only consumed by child 03.** Tier one matches the canonical ad key against `ads.meta_ad_id`; a name only match resolves through `ads` when the name is unique within the row's campaign (ad names are proven non unique, so unscoped name matching is forbidden). Tier two matches `adset_key` against `ads.meta_adset_id` for rows resolving no ad. Tier three matches `campaign_key` against `ads.meta_campaign_id` for the rest, so a row can be attributed at a coarser level while unattributed at a finer one. Child 01 owns key derivation; child 02 owns keeping `ads` fresh (the table already exists, created and seeded 2026-08-09); child 03 never re derives any tier. The stored `campaign_id` / `adset_id` / `ad_id` columns on `sessions` and `payments` (Love School backfilled once, 2026-08-09) are read first; extraction is the bridge for rows without them.
2. **Money is always stored and passed in minor units (paise) as an integer**, matching the existing `payments.amount` convention. `ad_insights_daily.spend_minor` follows the same rule. No float currency anywhere.
3. **A day means an Asia/Kolkata calendar day** in every view, table and query across all three children. Spend and revenue must bucket identically or daily ROAS is meaningless.

## Requirements

**User stories**:

- As the admin, I want to see spend, revenue and ROAS per ad and per campaign, so that I can decide which creatives to keep funding.
- As the admin, I want test transactions marked rather than silently mixed into revenue, so that headline numbers are not quietly wrong.
- As a client, I want to see performance for my own ads only, so that I can judge my campaigns without seeing anyone else's data.
- As the admin, I want to know when the numbers are stale or unattributed, so that I never present a figure I cannot defend.

**Acceptance criteria**:

- **AC-1**: A `utm_source` value carrying a stray `utm_source=` prefix aggregates together with its clean equivalent, displayed under the clean label (so `METAxAM` and `utm_source=METAxAM` become one `METAxAM` row).
- **AC-2**: A payment whose `amount` is at or below 500 paise is marked as Test, and a client whose `razorpay_key_id` begins `rzp_test` is marked as a Test account. Test rows remain visible and included in totals, carrying a visible Test badge.
- **AC-3**: The dashboard exposes two separately named metrics: Conversion rate (paid payments divided by sessions) and Checkout completion (paid payments divided by all payment attempts). Neither is labelled simply "conversion".
- **AC-4**: Every session and payment resolves canonical campaign, adset and ad keys: the stored `campaign_id` / `adset_id` / `ad_id` columns first, then extraction (`h_ad_id` and the `Ad_id` / `Ad ID` variants for the ad; `fbc_id`, else `utm_term` under the numeric guard, for the adset; `utm_id` or `campaign_id` for the campaign), then an ad name match scoped to the row's campaign, recording whether the ad match came from an identifier or from a name. Identifiers always win over names; an ambiguous name resolves nothing at ad level.
- **AC-5**: Rows with no resolvable ad key are grouped into an explicit Unattributed bucket and never silently dropped, so displayed totals always reconcile to real totals.
- **AC-6**: Every new table and view returns only the caller's own `client_id` rows unless the caller carries the `is_admin` claim.
- **AC-7**: An admin can map one Trace client to one or more Meta ad accounts, and can disconnect a mapping without deleting historical data.
- **AC-8**: The nightly sync writes one row per ad per Asia/Kolkata day into `ad_insights_daily`, keyed uniquely on `(ad_id, date_start)`, so re running it produces no duplicates and corrects previously stored values.
- **AC-9**: The first sync backfills from 2026-06-27, and every subsequent nightly run re syncs a rolling seven day window to absorb Meta's restatements.
- **AC-10**: Spend is stored as an integer in minor units with its currency code recorded alongside.
- **AC-11**: Each ad's creative thumbnail is copied into Supabase Storage and served from there, so it renders for every viewer regardless of their Meta role and does not expire.
- **AC-12**: An ad deleted or archived in Meta is marked inactive and keeps its historical rows, so past ROAS never changes retroactively.
- **AC-13**: Every sync attempt writes a row to `sync_runs` recording status, window covered, counts and any error. When the most recent run did not succeed, the Ads views show a stale data notice.
- **AC-14**: The Meta credential is never sent to the browser and never appears in a table readable through the client SDK.
- **AC-15**: The sync respects Meta's rate limit headers, backs off exponentially on error code 17, and targets a pinned API version rather than the newest one.
- **AC-16**: The Ads section drills down from campaign to ad set to ad, showing spend, revenue, ROAS, CPA and conversion rate at each level.
- **AC-17**: ROAS and CPA are computed from Trace's paid payments only, never from any Meta reported conversion figure.
- **AC-18**: The Ads views show a Spend with no tracked sessions row and an Unattributed revenue row, so spend and revenue columns each total to the real figure.
- **AC-19**: A row whose join came from an ad name rather than an identifier is visibly marked as such.
- **AC-20**: A row that resolves no ad key but carries an adset or campaign key is counted in that coarser rollup, marked as attributed at that level only, and appears in the finer levels' Unattributed buckets.

## Decision

**Chosen option**: Option 2: Sync Meta spend into dashboard owned tables, keep Trace payments as the revenue truth.

Pull spend and creative metadata from Meta on a nightly schedule into four new dashboard owned tables in Trace's existing Supabase project, join them to existing payment data through a canonical ad key resolved in a read layer view, and compute every revenue figure from Trace's own `payments` table.

Access to Meta uses Partner sharing: each client grants your Business Manager the view performance task on their ad account, and one agency System User token reads them all. No per client OAuth, no App Review, and the smallest permission you can ask a client for.

**Implementation skills**: none installed in this project.

## Feature design

This section holds only what spans all three children. Per child detail lives in each child spec.

**Data model sketch** (four new tables, all with `client_id` for direct row level security checks):

| Table | Purpose | Key columns | Constraints |
|---|---|---|---|
| `ad_accounts` | Maps a Trace client to a Meta ad account | `id` PK, `client_id` FK, `meta_ad_account_id`, `name`, `currency`, `timezone_name`, `status`, `connected_at` | `meta_ad_account_id` unique |
| `ads` | Slowly changing ad metadata and mirrored creative | `id` PK, `client_id` FK, `ad_account_id` FK, `meta_ad_id`, `meta_adset_id`, `meta_campaign_id`, `ad_name`, `adset_name`, `campaign_name`, `creative_thumbnail_path`, `creative_source_url`, `status`, `first_seen_at`, `last_synced_at` | `meta_ad_id` unique |
| `ad_insights_daily` | One row per ad per Asia/Kolkata day | `id` PK, `client_id` FK, `ad_id` FK, `date_start` date, `spend_minor` bigint, `currency`, `impressions`, `clicks`, `reach`, `raw` jsonb, `synced_at` | unique `(ad_id, date_start)` |
| `sync_runs` | One row per sync attempt | `id` PK, `ad_account_id` FK nullable, `kind` (`backfill`, `nightly`, `manual`), `status`, `date_from`, `date_to`, `meta_report_id` nullable, `ads_synced`, `rows_upserted`, `api_calls`, `error`, `started_at`, `finished_at` | none |

Existing Trace tables (`clients`, `products`, `sessions`, `events`, `payments`) are read only to this dashboard and are not altered.

**State transitions**:

- `ads.status`: `active` to `paused` to `inactive`. Reaching `inactive` (deleted or archived in Meta) never removes rows; it only hides the ad from current performance views.
- `sync_runs.status`: `running` to one of `success`, `partial`, `failed`. Only `success` clears the stale data notice.
- `ad_accounts.status`: `active` to `disconnected`. Disconnecting stops syncing but retains all history.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ads/sync` | POST | `kind` (req), `ad_account_id` (opt), `date_from` (opt) | `sync_run_id`, `status` | Cron secret header, or admin | 401 bad secret, 409 run already in progress |
| `/api/ads/accounts` | GET | none | available Meta accounts plus current mappings | admin | 502 Meta unreachable |
| `/api/ads/accounts` | POST | `client_id` (req), `meta_ad_account_id` (req) | mapping row | admin | 409 already mapped, 422 unknown account, 422 account currency is not INR |
| `/api/ads/accounts/:id` | DELETE | none | `status: disconnected` | admin | 404 unknown mapping |

Read paths for the Ads section are React Server Components querying Supabase directly under row level security, not REST endpoints, matching how the existing page already reads data.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Ads drill down | Spend | `ad_insights_daily.spend_minor`, summed |
| Ads drill down | Revenue | `payments.amount` where paid, summed. Never from Meta |
| Ads drill down | ROAS | Derived: revenue divided by spend, both already in paise |
| Ads drill down | CPA | Derived: spend divided by count of paid payments |
| Ads drill down | Conversion rate | Derived: paid payments divided by sessions, both resolved to the same ad key |
| Ads drill down | Checkout completion | Derived: paid payments divided by all payment attempts |
| Ads drill down | The ad a payment belongs to | Canonical ad key from child 01, matched to `ads.meta_ad_id` |
| Ads drill down | Whether a match is weak | `match_type` from child 01, either `ad_id` or `ad_name` |
| Ads drill down | Creative image | `ads.creative_thumbnail_path` in a private bucket, served through a short lived signed URL minted server side for the caller |
| Ads drill down | Campaign and ad set names | `ads.campaign_name`, `ads.adset_name` |
| Ads drill down | Test marking | Derived: `payments.amount` at or below 500, or `clients.razorpay_key_id` starting `rzp_test` |
| Ads drill down | Which calendar day a row belongs to | `created_at` and `paid_at` converted to Asia/Kolkata; Meta rows requested with the account's own day boundary then stored as the Asia/Kolkata date |
| Ads drill down | Data freshness | Newest `sync_runs` row with a non null `finished_at`, per ad account. A row still `running` displays as sync in progress, not stale |
| Sync job | Which accounts to sync | `ad_accounts` where `status = 'active'` |
| Sync job | Meta credential | Supabase Vault, read server side only |
| Sync job | Which API version to call | `META_API_VERSION` environment variable, pinned |

**Key invariants**:

- Revenue shown anywhere derives from `payments`, never from a Meta reported conversion field.
- Money is an integer in minor units everywhere. No floating point currency.
- Every displayed breakdown reconciles: the sum of its rows plus its Unattributed row equals the ungrouped total.
- `(ad_id, date_start)` is unique, so the sync is safe to re run at any time.
- The dashboard never writes to `clients`, `products`, `sessions`, `events` or `payments`.
- A day is an Asia/Kolkata day in every query.
- No Meta credential is ever readable through the publishable key.

**Security model**:

- Row level security on all four new tables uses the existing pattern for reads: `client_id` matching the JWT claim, or the `is_admin` claim. Unlike Trace's five core tables, these four also carry deliberate write policies (`WITH CHECK` on insert and update) permitting rows only when the JWT carries `is_admin`. In Postgres, `USING` alone gates reads and a missing `WITH CHECK` denies writes entirely, so this is required, and it keeps every write inside the publishable key plus row level security model with no service role key anywhere.
- Writes to the new tables happen only inside server side route handlers, authenticated as the admin identity, never from the browser.
- The Meta System User token lives in Supabase Vault, read server side at sync time. It is never selected into a table exposed through PostgREST and never sent to the client.
- Ad account mapping is admin only for now. Clients read their own ad performance but cannot connect or disconnect accounts.
- Compliance scope: this feature adds no new personal data. It stores ad identifiers, aggregate counters and creative images only. Existing customer personal data in `payments` is untouched and is not joined into any ad level view.

**Configuration required**:

- `META_SYSTEM_USER_TOKEN`: the agency System User token, stored in Supabase Vault rather than a plain environment variable. Prerequisite: create a System User in Business Settings and grant it the view performance task on each shared ad account.
- `META_API_VERSION`: the pinned Graph API version, for example `v25.0`. Deliberately not "latest".
- `META_BUSINESS_ID`: the agency Business Manager identifier, used to list available ad accounts.
- `CRON_SECRET`: shared secret proving a sync request came from Vercel Cron rather than the public internet.
- `SUPABASE_STORAGE_BUCKET`: the private bucket holding mirrored creative thumbnails, served only through signed URLs.

**Critical test scenarios**:

- Happy path: an ad with spend and matching paid payments shows correct spend, revenue and ROAS at ad, ad set and campaign level, verifies **AC-16**, **AC-17**.
- Idempotency: running the nightly sync twice over the same window produces no duplicate rows and no changed totals, verifies **AC-8**.
- Restatement: Meta revises spend for a day already stored, and the next nightly run overwrites it rather than adding a second row, verifies **AC-8**, **AC-9**.
- Reconciliation: a client with spend on untracked ads and revenue from unidentifiable ads still shows spend and revenue columns totalling the true figures, verifies **AC-5**, **AC-18**.
- Normalization: sessions split across `METAxAM` and `utm_source=METAxAM` aggregate into a single row, verifies **AC-1**.
- Failure case: the sync fails partway, `sync_runs` records `failed`, the Ads views show a stale notice, and the next run repairs the gap, verifies **AC-13**.
- Auth and permission: a client JWT querying ad tables sees only its own rows and receives an empty result for another client's ads; a client attempting to map an ad account is refused, verifies **AC-6**, **AC-7**.
- Credential safety: no query issued with the publishable key can return the Meta token, verifies **AC-14**.

## Build plan

Ordered as end to end slices (Tracer Bullet), since no build approach is recorded in `AGENTS.md`. Each slice is independently shippable and visible in the running app.

**Slice A, trustworthy numbers with no Meta dependency** (child 01):

Done 2026-08-09 ahead of the views: the `ads` table (pulled forward from child 02, with row level security), Love School's 67 ad seed from Sharan's Ads Manager export, the additive `campaign_id` / `adset_id` / `ad_id` columns on `sessions` and `payments`, and the one time Love School backfill (verified: hierarchy consistent, idempotent, originals untouched byte for byte).

1. Create the read layer views: normalized UTM, Test marking, the three canonical keys with `match_type`, and the adset and campaign fallback tiers, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-20**.
2. Expose Conversion rate and Checkout completion as separately named metrics, satisfies **AC-3**.
3. Add the Unattributed bucket to every breakdown, satisfies **AC-5**.
4. Verify the views under a client JWT and an admin JWT, satisfies **AC-6**.

**Slice B, one ad account end to end** (child 02):

5. Migration creating the four tables with row level security policies matching the existing pattern, satisfies **AC-6**, **AC-7**.
6. Thin typed Meta client against the pinned version, with rate limit handling and backoff, satisfies **AC-15**.
7. Store the System User token in Supabase Vault and read it server side only, satisfies **AC-14**.
8. Admin mapping screen listing available accounts and assigning one to a client, satisfies **AC-7**.
9. Sync one account for one day, writing `ads` and `ad_insights_daily` and one `sync_runs` row, satisfies **AC-8**, **AC-10**, **AC-13**.

**Slice C, full sync** (child 02):

10. Backfill from 2026-06-27 using asynchronous insight jobs, satisfies **AC-9**.
11. Nightly Vercel Cron run with the rolling seven day re sync window, satisfies **AC-9**, **AC-13**.
12. Asia/Kolkata day bucketing on both sides of the join, satisfies **AC-8**.
13. Mirror creative thumbnails into Supabase Storage, satisfies **AC-11**.
14. Mark ads inactive when they disappear from Meta, retaining history, satisfies **AC-12**.

**Slice D, the Ads section** (child 03):

15. Campaign to ad set to ad drill down using the existing bento and token system, satisfies **AC-16**.
16. Spend, revenue, ROAS, CPA and conversion rate at each level, computed from Trace payments, including the campaign tier fallback rows, satisfies **AC-16**, **AC-17**, **AC-20**.
17. Reconciliation rows for unmatched spend and unattributed revenue, satisfies **AC-18**.
18. Name match badge and creative thumbnails, satisfies **AC-11**, **AC-19**.
19. Stale data notice driven by the latest `sync_runs` row, plus empty and loading states, satisfies **AC-13**.

## Consequences

**Positive**:

- Phase 1 stops being blocked. Slice A needs no Meta access, no credentials and no external approval, so the revenue overview can ship on correct numbers immediately.
- One source of truth for revenue removes an entire class of client argument about whose number is right.
- Storing Meta's full response as `raw` jsonb means a metric you did not anticipate needs no re sync to backfill, only a new column or view.
- Partner access is the smallest thing you can ask a client for, and it is read only, so a client can grant it without risk and revoke it themselves.
- Unique `(ad_id, date_start)` makes the sync idempotent, which means a failed run is always safe to simply re run.

**Negative and tradeoffs**:

- Love School's ad level history is now largely solid, not approximate: the 2026-08-09 normalisation resolved 7,730 of 8,209 sessions to an exact ad (34 percent carried real ad identifiers, and the campaign scoped name rule recovered the rest against Meta's own hierarchy export). The residual caveats: rows resolved by name are marked as such and a Meta rename still forks history, and roughly 160 paid sessions resolve only to adset or campaign level. The earlier claim here that Love School had no session side ad identifiers was wrong and is corrected by the profiling in child 01.
- Writing a Meta client by hand means owning pagination, asynchronous job polling and rate limit handling, roughly a day of work that the official SDK would have provided.
- Cost side metrics only ever cover Meta. Any spend on another channel stays invisible, so agency wide ROAS is really Meta ROAS and must be labelled that way.
- Attribution stays last touch and single session. A customer who clicks an ad and returns later through a direct visit credits the later session, so ad level revenue is systematically understated for considered purchases.
- Four new tables and a scheduled job add operational surface to a project that currently has almost none. There is now something that can silently stop working overnight.
- Keeping test rows visible rather than filtering them means every headline number includes a small amount of test revenue. At roughly five transactions per launch this is immaterial, but it is not zero.

**Neutral**:

- The new tables live in Trace's Supabase project but are owned by this dashboard. That boundary is a convention, not something the database enforces, so it needs stating in `AGENTS.md`.
- Meta sunsets API versions on a schedule, so the pinned version becomes recurring maintenance roughly annually.
- Creative thumbnails in Supabase Storage will grow slowly and need no lifecycle policy at this scale, but will eventually.

## Follow-up

- [ ] Confirm before building Slice B whether Partner shared ad accounts count as "accounts you own" for Standard access. If Meta requires Advanced access, App Review becomes a launch blocking prerequisite with a multi week lead time, and the admin picker over your own accounts is the fallback.
- [ ] Advanced access, if it ever becomes necessary, must be maintained with at least 500 Marketing API calls every 15 days at under 15% error rate. A four client nightly sync may not naturally reach that.
- [ ] Fix the `utm_source=` prefix at the point of capture in the Trace repository. The view in child 01 repairs history, but bad rows keep arriving until the capture is fixed.
- [ ] Apply the standard URL template from [04-utm-template-standard.md](04-utm-template-standard.md) in Ads Manager for every client, and rename any Meta campaign, ad set or ad containing `&`. (Supersedes the earlier note about Love School's dynamic URL parameters. History was recovered after all: the 2026-08-09 backfill resolved it against Meta's own hierarchy export.)
- [ ] Have Trace's capture write `campaign_id`, `adset_id` and `ad_id` directly on new sessions and payments (the template puts all three in the URL). Until then the columns stay null on new rows and the views bridge by extraction.
- [ ] Mirror the three new columns and the `ads` table in the Trace repository's schema types when convenient.
- [ ] Decide whether to import spend from channels other than Meta before labelling anything as overall ROAS.
- [ ] No `docs/scope/` exists in this project, so these build tasks live here as the source of truth. Consider running `/scope` to enroll this work if you want lifecycle tracking.
- [ ] No build approach is recorded. The plan above assumes end to end slices; record the project default in `AGENTS.md` if you want a different shape.
- [ ] `tti_ms` is populated on zero rows out of 10,395. Either fix the capture or drop the column; do not build anything that reads it.

## Rationale

Reasoning, options considered, the data evidence behind these choices, and references: see [rationale.md](rationale.md).

# Memory — Trace Dashboard

Last updated: 2026-08-09 (Slice A merged to main; Slice B planned and ready to build)

## What was built

**Slice A — metrics foundation — COMPLETE and merged into `main`** (17 commits, fast-forward, 109 tests passing). Full detail of how it was built is in git history; what matters going forward:

- 11 `public.metric_*` immutable SQL functions — the single definition of every attribution extraction rule, RPC-callable so they are unit-testable.
- Four `security_invoker` views: `v_ad_name_resolution`, `v_sessions_attributed`, `v_payments_attributed`, `v_funnel_by_session`.
- `src/lib/metrics/definitions.ts` (the two named metrics) and `attribution.ts` (`groupWithUnattributed`, `tierKeyOf`).
- Vitest harness: `tests/helpers/supabase.ts` exports `adminClient()`, `clientClient()`, `countRows()`, `expectStableEqualCounts()`. All tests run against the live database through real RLS-scoped JWTs.

**Sharan's own migrations, also merged:** the `ads` dimension table, a manual seed of Love School's 67 ads, `campaign_id`/`adset_id`/`ad_id` columns on `sessions` and `payments`, and a one-time Love School backfill.

**Slice B — planned, not started.** Branch `slice-b-meta-ads-sync` exists off `main` with only the plan committed (`37b46b7`). Plan: `docs/superpowers/plans/2026-08-09-meta-ads-sync-implementation.md` — five tasks, with full SQL and TypeScript written out. The SDD workspace and ledger are initialised at `.superpowers/sdd/2026-08-09-meta-ads-sync-implementation/`, and the Task 1 brief is already generated. Design rationale lives in `~/.claude-work/plans/goofy-foraging-stream.md`.

## Decisions made

**Slice A (all live and load-bearing):**
- Attribution is three tiers — ad, then ad set, then campaign — exposed as `attribution_tier`, always the most specific tier that resolved.
- Every key reads `coalesce(stored column, extracted)`. Neither source alone suffices: Love School relies on stored IDs, Occultyogis entirely on extraction.
- Ad names resolve only when unique within the row's campaign AND client, via the shared `v_ad_name_resolution` view. Ambiguous names resolve to nothing, never guessed.
- Ad and ad-set IDs get a strict numeric guard; campaign IDs get only a junk filter, because the test client legitimately uses `june-test-01`.

**Slice B (decided this session, recorded in the plan):**
- **Scope stops at one ad account, one day, end to end.** Backfill, nightly cron, creative mirroring and inactive-ad marking are Slice C.
- **A dedicated Supabase Auth service identity** (`SYNC_IDENTITY_EMAIL`/`_PASSWORD`), not the Phase 0 dev stub — that stub's password is committed to this repo and it is deleted in Phase 2, so a production job must not depend on it.
- **Meta token in a server-only env var, not Supabase Vault** — a deliberate deviation from the spec. Reading Vault needs privileges forbidden inside a request handler; the only route under publishable-key + RLS would be a `SECURITY DEFINER` function, which would make the token readable over PostgREST by any admin browser session. An env var is never reachable by the client SDK at all.
- **Admin-mapped connection now, client self-serve OAuth later.** No "Connect Meta" button in Slice B. `ad_accounts.token_ref` is reserved nullable so self-serve drops in without restructuring. Self-serve is pointless before Phase 2 real login exists, since no real client can log in today.
- Phase 2 stays sequenced **after** Slice B.

## Problems solved

- **Meta access: the spec's central premise is wrong.** `rationale.md` claims Partner sharing "sidesteps App Review". Verified against Meta's authorization docs on 2026-08-09: *"If your app is managing other people's ad accounts, you need advanced access to the `ads_read` and/or `ads_management` permissions."* Partner-shared accounts still belong to the client, so **`ads_read` Advanced access via App Review is a hard prerequisite**. Per-client OAuth does NOT avoid this either — access level is a property of the app, not of how the token was obtained. One `ads_read` review unlocks both models.
- **The spec conflated two mechanisms.** The *permission access level* (Standard/Advanced) gates other businesses' accounts and needs App Review. The *Marketing API Access Tier* — renamed from "Ads Management Standard Access" on 4 May 2026, tiers now Limited/Full — governs rate limits and system-user quotas, and is what carries the 500-calls-per-15-days and sub-15% error-rate rule. The spec attributed that floor to Advanced access and partly reversed the original OAuth decision on it.
- **Occultyogis needs no backfill.** Confirmed by querying the live views: they already resolve 2,342 of 2,732 sessions to an ad key, plus ad-set and campaign keys, purely by extraction with zero rows in `ads`. The only thing missing is *names*, which the views join in from `ads` at read time. So populating `ads` through the Slice B sync lights them up automatically — no normalisation page, no migration. A page would also have meant the browser writing to Trace's core tables, which is forbidden.
- **Five tests passed against deliberately broken implementations** during Slice A, all caught by mutation-testing in review. Recurring failure mode here: tests that assert only that rows exist. For every new test, ask concretely which broken implementation it would catch.

## Current state

`main` holds all of Slice A and is **17 commits ahead of `origin/main` — nothing has been pushed.** Working tree clean. Currently on branch `slice-b-meta-ads-sync`.

Live coverage through the views: 9,789 of 10,693 sessions resolve an ad. Love School 94% via stored IDs, Occultyogis 86% via extraction with no `ads` rows at all.

Known limitations, both recorded in the specs: 5 of ~964 paired rows have the session resolving an ad while its payment resolves nothing (upstream cause — the ad ID sits after a `#` fragment and Trace's payment capture copied only pre-fragment params); and the cross-tenant ad-name guard cannot be proven red while only one client has rows in `ads`.

## Next session starts with

Consider pushing `main` to origin first — 17 commits of finished, reviewed work are local-only.

Then **Slice B Task 1**: the migration creating `ad_accounts`, `ad_insights_daily` and `sync_runs` with RLS read policies plus the `WITH CHECK` write policies, and the `ads.ad_account_id` foreign key. The brief is already written at `.superpowers/sdd/2026-08-09-meta-ads-sync-implementation/task-1-brief.md`; use superpowers:subagent-driven-development against the plan file. **Tasks 1 to 4 need no Meta access at all** and are fully buildable now — only Task 5 makes a live call.

## Open questions

- **Blocking Task 5, none started:** Business Verification for the Meta app; App Review for `ads_read` Advanced access (read-only, do not request `ads_management`); creating the agency System User and issuing its token; and at least one client granting it the view-performance task. Occultyogis first — it unlocks names for 2,342 sessions and makes the cross-tenant guard testable. If the review lead time is unacceptable, the hedge is a third-party connector (Fivetran/Airbyte/Supermetrics) that already holds Advanced access.
- Sharan has rolled a new standard UTM template out on the Meta dashboard — unconfirmed whether it is on all four clients' accounts or only some. Affects how quickly the raw parameters stop needing repair rules.
- Should the `#`-fragment capture bug be fixed in the Trace repo? It is the root cause of the session/payment ad split.
- Categorical chart palette for multi-series charts, still deferred to the first chart.
- Whether to import non-Meta spend before labelling anything "overall ROAS".

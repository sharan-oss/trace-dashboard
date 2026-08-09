# Memory — Trace Dashboard

Last updated: 2026-08-09 (Slice A metrics foundation built; branch merge-ready)

## What was built

**Sharan's own work this session (committed in `006806a`, applied live):** the `ads` dimension table with RLS, a manual seed of Love School's 67 ads from an Ads Manager export, additive nullable `campaign_id`/`adset_id`/`ad_id` columns on `sessions` and `payments`, and a one-time Love School backfill. Migrations `20260809130000`–`20260809130300`. Also a new child spec `04-utm-template-standard.md` (one URL parameter template for every client, plus the hard rule: never put `&` in a Meta campaign/ad set/ad name — it truncates the URL mid-value), and a rewrite of `01-metrics-foundation.md` from two-tier to three-tier attribution.

**Slice A, built by me across 7 tasks — branch `slice-a-metrics-foundation`, 16 commits, NOT merged to `main`:**

- `docs/superpowers/plans/2026-08-09-metrics-foundation-implementation.md` — the implementation plan, revised mid-build for the three-tier design. Its "Plan revision" section holds the live-verified facts that supersede the spec.
- Vitest harness: `vitest.config.ts`, `tests/helpers/supabase.ts` (`adminClient()`, `clientClient()`, `countRows()`, `expectStableEqualCounts()`). Node environment, runs against the live DB through both Phase 0 dev identities. `npm test` / `npm run test:watch`.
- 11 `public.metric_*` immutable SQL functions across `20260809120000` and `20260809140000` — the single definition of every extraction rule, RPC-callable so they are directly unit-testable.
- Four views, all `security_invoker = true`: `v_ad_name_resolution` (`140050`), `v_sessions_attributed` (`140100`), `v_payments_attributed` (`140300`), `v_funnel_by_session` (`140500`).
- `20260809140400` + `20260809140600`: a zero-parameter RPC returning `v_payments_attributed`'s definition, so a test can assert the view still joins `v_ad_name_resolution` (that join has zero live rows to test against). Locked to `authenticated` only.
- `src/lib/metrics/definitions.ts` (the two named metrics) and `src/lib/metrics/attribution.ts` (`groupWithUnattributed`, `tierKeyOf`).
- 109 tests passing, typecheck clean.

## Decisions made

- **Attribution is three tiers — ad, then ad set, then campaign.** A row is attributed at the most specific tier that resolves, exposed as `attribution_tier`. A row attributed at ad set level is simultaneously Unattributed at ad level; both must hold.
- **Every key reads `coalesce(stored column, extracted)`.** Stored IDs win; extraction is the bridge for rows arriving after the backfill and for clients never backfilled. Neither source alone is sufficient — Love School relies on stored, Occultyogis entirely on extraction.
- **Ad names resolve only when unique within the row's campaign AND the row's client.** Extracted into the shared view `v_ad_name_resolution` so both attribution views join one copy and cannot drift. An ambiguous name resolves to nothing — never guessed.
- Ad IDs get a strict numeric guard (`^[0-9]{6,}$`); campaign IDs get only a junk filter, because the test client legitimately uses `june-test-01`. Ad set IDs get the numeric guard, which is what makes reading `utm_term` safe (it carries the ad set ID in one template era and the ad set NAME in another).
- The funnel view is built over `sessions LEFT JOIN events`, not over `events`, so the ~900 event-less sessions still get a row. Stages mean "reached this stage or any later one".
- Migration filenames must match dependency order; several were renumbered mid-build after `v_sessions_attributed` (`140100`) was found depending on a view created at `140200`.
- Views live in `public` and are granted select to `anon, authenticated`; the extraction helpers are in `public` deliberately so they are RPC-testable (they are pure text/jsonb transforms touching no table).

## Problems solved

- **Five tests passed against deliberately broken implementations** — all caught by reviewers mutation-testing the code, all fixed. A reversible sort order, a deletable ambiguity guard, a deletable tenant guard, a funnel whose six stages could collapse into one expression, and an aliasing test comparing different arguments on each side. When writing tests here, ask concretely which broken implementation each one catches; asserting only that rows exist is the recurring failure mode.
- **Three spec claims were factually wrong and are now corrected in the spec files.** Love School was never without session-side ad IDs (34% carried them under the `Ad+ID` key spelling, which the original profile missed because it only looked for `h_ad_id`/`ad_id`; 94% after the backfill). The 16 session-less payments are not "permanently unattributable" — 9 resolve at ad tier, because payments attribute from their own `utm_params`. And `utm_id` is not always numeric.
- Unexpanded Meta macros (`{{ad.id}}`, `%7b%7bad.id%7d%7d`), plus `null` and `_removed_`, appear in real data and would create phantom ads; all are rejected.
- `metric_ad_id_from_url` originally took the first matching key and normalised afterwards, so a junk first occurrence discarded a valid later one. Both extractors now scan and filter.
- `regexp_matches` with a global flag on a key pattern, never `LIKE '%h_ad_id%'` — in `LIKE`, `_` is a single-character wildcard, so `'%fbc_id%'` matches `fbclid`.

## Current state

Slice A is complete and **merge-ready**: final whole-branch review returned "ready with caveats", one fix wave addressed everything it flagged, and the scoped re-review confirmed all six fixes with no new breakage. Nothing merged to `main` — awaiting Sharan's decision.

Live coverage: 9,789 of 10,693 sessions resolve to an ad. Love School 94% via stored IDs; **Occultyogis Vastu resolves 2,023 ad keys purely by extraction despite having zero rows in `ads`** — that asymmetry is deliberate and tested, not a bug.

Known limitations, both recorded in the specs: for 5 of ~964 paired rows the session resolves an ad while its payment resolves nothing, splitting one journey across two ads (upstream cause — the ad ID sits after a `#` fragment in the landing URL and Trace's payment capture copied only pre-fragment params; 0.68% of paid revenue, will surface in Slice D). And the cross-tenant ad-name guard cannot be proven red while only one client has rows in `ads`.

Deferred, none merge-blocking: `set search_path` on the 12 `metric_*` functions (Supabase advisor noise, all `SECURITY INVOKER` so not exploitable); migration filename drift vs `schema_migrations` (pre-existing project-wide); sessions-side list tests still sample with `.limit()`; the tier ladder is duplicated verbatim across the two attribution views.

## Next session starts with

Merge `slice-a-metrics-foundation` into `main` if Sharan approves (fast-forward, no conflicts). Then **seed Occultyogis Vastu into `ads`** — it needs an Ads Manager export from Sharan, follows the `seed_love_school_ads` migration as its pattern, and unblocks both their ad-level names and the currently-unprovable cross-tenant guard. Then Slice B (child 02, the Meta sync) — but check the launch-blocking access question below first.

## Open questions

- **Launch-blocking before Slice B:** does Meta's Standard access cover Partner-shared ad accounts, or does it trigger Advanced access and App Review? Links in the spec's `rationale.md` References. Advanced access must be maintained at 500+ Marketing API calls per 15 days, which a four-client nightly sync may not reach.
- Only Sharan can do: create the System User in Business Settings and have clients grant view-performance; roll the standard URL template out to all four clients and rename any Meta object containing `&`.
- Should the `#`-fragment capture bug be fixed in the Trace repo? It is the root cause of the session/payment ad split.
- Categorical chart palette for multi-series charts, still deferred — decide when the first chart is built, must stay distinct from the three semantic status colors.
- Whether to import non-Meta spend before labelling anything "overall ROAS".

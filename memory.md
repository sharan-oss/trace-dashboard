# Memory — Trace Dashboard

Last updated: 2026-08-10 (L2 attribution live; RLS leak fixed; dashboard is next)

## What was built

**Slice A — metrics foundation** — merged to `main` and pushed. 11 `public.metric_*` extraction functions, four `security_invoker` views (`v_ad_name_resolution`, `v_sessions_attributed`, `v_payments_attributed`, `v_funnel_by_session`), `src/lib/metrics/` (the two named metrics + `groupWithUnattributed`/`tierKeyOf`), and a Vitest harness (`tests/helpers/supabase.ts` → `adminClient()`, `clientClient()`, `countRows()`, `expectStableEqualCounts()`). All tests run against the live DB through real RLS-scoped JWTs.

**L2 ingestion — built by Sharan directly in Supabase**, no migrations in either repo:
- `customers` — identity: `client_id`, `email_norm`, `phone_norm`, `name`, **`l1_payment_id`** (the acquisition link), `first_paid_at`. 652 rows, all with `l1_payment_id`.
- `external_payments` — the L2 mirror: `client_id`, `customer_id`, `source`, `external_payment_id`, `external_order_id`, `status`, `amount` (paise int), normalised email/phone, `description`, `product_name`, `raw_payload`, `paid_at`. 12 rows.
- `sync_runs` — Razorpay job log: `source`, `triggered_by`, `window_from/to`, `pulled/inserted/deduped/reconciled/linked`. 40 runs.
- Views `customer_payments_unified` (UNION of paid Trace payments + captured external) and `customer_spend` (per-customer lifetime value).
- `payments` gained a `customer_id` column.

**This session (commit `f791cda`, merged to `main`, NOT yet pushed):** the security fix below, plus `customer_id` added to `v_payments_attributed`. 124 tests passing, typecheck clean.

## Decisions made

- **L2 credit rule: the ad behind the customer's FIRST L1 purchase** gets credit for everything they buy later. Measures acquisition value, and credit never reshuffles.
- **L2 classification**: Sharan tags which `product_name` values count as L2, per client, after seeing real data.
- **L2 ingestion runs through Trace**, reusing `getClientWithCredentials(clientId)` in `/Users/sharanv/apps/Trace/src/modules/payment/catalog.service.ts` — the dashboard stays forbidden from decrypting `*_secret_enc`.
- **Dashboard is next, ahead of Slice B.** Slice B's payoff task is blocked on Meta App Review for weeks; the dashboard needs nothing external.
- Meta: **`ads_read` Advanced access via App Review is a hard prerequisite** — partner-shared accounts count as "other people's ad accounts". Per-client OAuth does not avoid it. One review unlocks both models. Nothing started.

## Problems solved

- **CRITICAL, now fixed: a live tenant-data and PII leak.** `customer_spend` and `customer_payments_unified` were created without `security_invoker`, so they bypassed RLS on `customers`, `external_payments` and `payments`, while granting select to `anon`. Measured as `anon` — the role anyone gets from the publishable key, which ships to the browser — **652 customer rows across 2 clients, including email, phone and lifetime spend**. Fixed in `supabase/migrations/20260810090000_l2_tables_rls_and_view_invoker.sql`: `security_invoker` on both views **plus** the read policies the three L2 tables never had. Both halves were required — RLS was enabled with *zero* policies (deny-all), which is why the leak was only reachable through the views. Regression tests in `tests/l2-rls.test.ts`; `anon` now returns 0 everywhere. **Never relax those assertions.**
- **`v_payments_attributed` was missing `customer_id`** — the join key for ad → L1 → customer → L2. The Slice A base-column parity test caught it. Note `create or replace view` cannot insert a column mid-list, only append, so it sits last deliberately.
- Five tests once passed against deliberately broken implementations (Slice A) — all caught by mutation-testing in review. For every new test, ask which broken implementation it catches. Asserting only that rows exist is the recurring failure mode here.

## Current state

`main` is **1 commit ahead of `origin/main`** (the security fix) — everything before it is pushed. Branch `slice-b-meta-ads-sync` holds only the Slice B plan.

**The L2 thesis is proven.** 12 external payments totalling ₹97,440; **11 trace back to a specific ad**, ₹87,716 across 5 ads. Love School's ten L2 sales average ₹9,724 each against a ₹99 front end. **L2 is already 1.6× all L1 revenue combined (₹61,007).** Per ad, entirely through the read layer:

| Ad | Customers | L1 | L2 | Multiple |
|---|---|---|---|---|
| B1_LMF_AD 6 (…310519) | 161 | ₹15,939 | ₹48,621 | 3.05× |
| B1_LMF_AD 6 (…850519) | 41 | ₹4,059 | ₹19,448 | 4.79× |
| VS - LS_10 | 72 | ₹7,227 | ₹9,724 | 1.35× |
| AM01-TOF-OPEN | 59 | ₹5,841 | ₹9,724 | 1.66× |

The top two share an identical `ad_name` but are different ad IDs — exactly the collision the campaign-scoped name rule guards against.

L1 side: 9,789 of 10,693 sessions resolve an ad; ₹61,007 across Love School (₹45,845), Occultyogis (₹15,155), Batra (₹7).

**Known-bad, still open:**
- **`product_name` is null on 10 of 12 external payments** — every Love School row, i.e. all ₹97,242 of the real L2 revenue. The "tag which products are L2" workflow has nothing to tag for the client that matters.
- **Occultyogis' 2 external rows are ₹99 each**, identical to their L1 price — likely Trace-checkout payments the mirror re-imported, not upsells. Check `external_order_id` against `payments.order_id` before counting them as L2, or revenue double-counts.
- **Only 12 external rows, 12 Jul–8 Aug** — a partial import. Caption any L2 figure as incomplete.
- **None of the L2 schema is in version control** — `customers`, `external_payments`, `sync_runs`, `payments.customer_id` and the two views exist only in the live DB. Check whether the Trace repo has them; if not they're undocumented in both.
- **`sync_runs` name collision**: Slice B's plan (`docs/superpowers/plans/2026-08-09-meta-ads-sync-implementation.md`, Task 1) creates a differently-shaped `sync_runs` for Meta. Rename it to `ad_sync_runs` before that task runs or the migration fails.

## Next session starts with

Push `main` (1 commit), then **build the Phase 1 revenue overview** — the approved design is in `~/.claude-work/plans/goofy-foraging-stream.md`. One admin screen at `/` replacing the Phase 0 proof page, reading the Slice A views.

Needs building: `src/lib/format.ts` (paise → ₹ in `en-IN`, percent, null-safe — nothing exists, `src/lib/utils.ts` has only `cn`); `src/lib/queries/revenue.ts` (aggregate in Postgres, never by paging rows into JS); shadcn `chart` via `npx shadcn add chart` (**needs a `react-is` override on React 19**); and a fix to `BentoTile`, whose `col-span-2` has no responsive variant so a 2x2 tile overflows the one-column mobile grid.

Reuse: `BentoGrid`/`BentoTile`/`StatusBadge`/`Button`, `conversionRate`/`checkoutCompletion` from `src/lib/metrics/definitions.ts`, and the `getDevJwt`/`createClientWithJwt` pattern already in `src/app/page.tsx`. Design rules are settled and binding (`docs/superpowers/specs/2026-08-08-visual-design-system.md`): no shadows, hairline borders only, colour = semantic status only, Geist Sans for KPI numbers, Inter for body, **Geist Mono for tabular figures**. Keep charts single-series so the deferred categorical palette stays deferred.

Headline tile should read **L1 ₹61,007 · L2 ₹97,440**, L2 captioned as a partial import.

## Open questions

- Backfill the rest of the Razorpay history — currently only 12 external payments exist.
- Fix `product_name` capture for Love School, or L2 classification cannot work for the client that matters.
- Confirm whether Occultyogis' two ₹99 external rows are re-imported L1s.
- Meta App Review: Business Verification, then `ads_read` Advanced (read-only, not `ads_management`), then the System User and per-client view-performance grants. Occultyogis first — it unlocks names for 2,342 sessions and makes the cross-tenant guard testable.
- Seed Occultyogis into `ads` (needs an Ads Manager export) — they resolve 2,342 ad keys by extraction but show no names.
- Should the `#`-fragment capture bug be fixed in Trace? It splits 5 of ~964 paired rows across two ads.
- Categorical chart palette and dark mode both still deferred.

# Funnel section — where's the leak, and whose fault is it?

**Date:** 2026-08-16
**Status:** approved (brainstormed with Sharan; architecture A chosen over fattening the view)
**Route:** `/funnel?lens=campaign|page|product|ad`

## Why this page exists

`/funnel` is the last stub in the IA settled 2026-08-10. Its database layer shipped with the
metrics foundation — `v_funnel_by_session` (migration `20260809140500`), one row per session
with stages meaning "reached this stage OR any later one", built that way deliberately
because the raw event stream is not monotonic. The Customers section then deferred
aggregated audience analysis here twice by name.

The page answers one question: **where do people leak between click and payment, and is it
the ad's fault or the page's fault?** The lenses are the answer's structure:

- **Campaign lens** — same page, different traffic. If campaigns differ, the traffic is the
  variable: the ad's fault.
- **Landing-page lens** — same traffic, different page. If pages differ, the page is the
  variable: the page's fault.
- **Product lens** — the owner's coarse cut when a client runs several offers.
- **Ad drill** — campaign row → its ads, with creative previews (AdPeek), because "which ad
  sends people who never open the form" is a scaling decision.

## What the live data says (profiled 2026-08-16, all time)

| Stage | Love School | Occultyogis Vastu |
|---|---|---|
| Sessions | 10,683 | 14,103 |
| Page view | 9,784 (91.6%) | 13,860 (98.3%) |
| Form opened | **1,132 (10.6%)** | 5,639 (40.0%) |
| Form started | 1,119 | 5,327 |
| Form submitted | 822 | **960** |
| Payment opened | 818 | 954 |
| Paid | 469 | 527 |

**The two clients leak in opposite places.** Love School loses ~90% of loaded sessions
before the form ever opens — the page is the leak. Occultyogis opens forms at 40% and then
loses 82% between form start and submit — the form is the leak. Same product shape,
opposite diagnosis; a funnel page that can say that is earning its keep.

Other live facts the design uses:

- Campaign funnels differ at solid samples: Love School campaigns range 8.8%–13.1%
  form-open across 1,125–3,652 sessions each.
- The landing-page lens is live A/B gold: Occultyogis runs two LP variants at scale
  (`devurja-vastu-v4-fb`: 7,458 sessions, 39.0% open · `devurja-vastu-fb`: 6,613, 41.1%);
  Love School has a 55-session variant at 40% open / 20% paid against the main LP's
  10.4% / 4.3%.
- **Dead traffic is real**: 899 Love School sessions (8.4%) never fired `page_load` — paid
  clicks that never became visitors — and 1,094 sessions carry no network telemetry, of
  which exactly 0 converted.
- The device/network "audience quality" thesis is **weak** in live data (<500 kbps converts
  at 5.11%, 500–1500 at 3.15%): deliberately not a v1 lens, and never a headline claim.

## Decisions

1. **Headline: the stage funnel with a computed biggest-leak callout** ("89.6% of visitors
   who load the page never open the form") — max relative drop between adjacent stages from
   page-load onward. Dead traffic is excluded from the callout; it has its own strip.
2. **Lenses: Campaign (default) | Landing page | Product**, campaign rows drill to ads.
   Device/network excluded from v1 on evidence.
3. **Wasted-clicks strip included** — never-loaded count/% and no-telemetry count with its
   conversion count from data (never an assumed zero). Counts, not accusations.
4. **Depth: static + segment table.** No stage click-drill (the table already shows every
   transition per segment), no trend chart (~7 weeks of data; Overview owns time series).
5. **Architecture A**: `v_funnel_by_session` stays pure stages-per-session; the RPCs compose
   it with `sessions` and `v_sessions_attributed` at read time. Landing-page normalization
   is a `metric_*` function, per the standing rule that extraction rules are never inline.

## Data layer (migration `20260816100000_funnel_rpcs.sql`)

- `metric_normalize_landing_page(text)` — lowercase, strip `^https?://`, cut at `?`/`#`,
  collapse the trailing slash; null for null/blank. Immutable, unit-tested through `.rpc()`.
- `funnel_overview(p_client_id, p_days)` — sessions, the six reached_* counts,
  never_loaded, no_telemetry, no_telemetry_converted. IST cutoff on the view's `day_ist`.
- `funnel_breakdown(p_client_id, p_days, p_dimension, p_campaign default null)` —
  dimension ∈ campaign|page|product|ad (else raises); ad requires p_campaign. Returns
  segment_key, segment_label, sessions, six stage counts; null-key buckets (Unattributed /
  Unknown page / No product) always emitted; ordered sessions desc. Names resolved from
  `ads`/`products` at read time.
- Housekeeping: revoke anon's residual SELECT on `v_funnel_by_session` (RLS already yields
  zero rows; the grant should not exist — same cleanup as the L2 adopt-migration).
- Doctrine: `security invoker`, `set search_path = public`, counts only; every ratio is
  computed in TS through the null-safe `ratio()` family.

## Page

`src/app/(dashboard)/funnel/page.tsx` replaces the stub. Blocks, top to bottom:

1. **Stage funnel card** (`funnel-stages.tsx`) — six horizontal bars, width ∝ sessions
   reached with a min-width floor, count + % on each bar, between-stage drop % in the gaps;
   Paid bar indigo-400, others slate (the 2-series palette). Callout sentence on top.
2. **Wasted-clicks strip** (`wasted-clicks-strip.tsx`) — hidden when both counts are zero.
3. **Segment table** (`funnel-segments.tsx`) — lens control as URL-driven segmented links;
   columns Segment · Sessions · Form open % · Form submit % · Paid %, every rate with its
   count beside it, muted under the n≥20 `isRateReadable` floor. Campaign rows chevron to
   `?lens=ad&campaign=`; the ad view has a back link and AdPeek creative previews. Footer
   totals reconcile to the stage card exactly.

Stage order and labels live once in `src/lib/metrics/funnel-stages.ts`; the read layer in
`src/lib/queries/funnel.ts` mirrors the other query files.

No test badges on this page: sessions carry no test marking, and pretending otherwise would
be fabrication. Stated here so nobody "fixes" it later.

## Tests

`tests/funnel-rpcs.test.ts` (~11): stage monotonicity in overview and every segment;
Σ segments = overview for every lens and range (attemptStable pattern); SDK-oracle stage
counts for one campaign; normalization unit cases; ad drill sums to its campaign row and
errors without p_campaign; invalid dimension raises; other-tenant zeros; anon refused on
both RPCs and the view; range monotonicity.

## Verification

Full suite; production build + Playwright at 1440/375; on-screen stage counts reconciled
against live SQL re-run same day; Occultyogis page lens shows both LP variants; campaign →
ad drill shows AdPeek previews; Batra renders with muted rates; zero console errors.

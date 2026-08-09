# Memory — Trace Dashboard

Last updated: 2026-08-10 evening (Phase 1 Overview shipped + dark design system v2 shipped)

## What was built

**Phase 1 Overview (commit `3fbfcaa`)** — IA settled and approved: one page per decision — Overview `/`, Ads `/ads`, Customers `/customers`, Funnel `/funnel` (last three are stub routes), left sidebar, **single-client view only** with a cookie-backed client switcher. Files: `src/components/{app-shell,sidebar-nav,client-switcher,date-range-picker}.tsx`, `src/components/overview/{kpi-tile,revenue-chart-card,top-ads-table}.tsx`, `src/lib/{format,range,client-selection}.ts`, `src/lib/queries/overview.ts`, `src/app/actions.ts` (cookie server action), rewritten `src/app/page.tsx` (Phase 0 proof page gone; its RLS proof lives in tests). Migration `supabase/migrations/20260810100000_overview_aggregate_rpcs.sql`: three `security invoker` RPCs — `overview_kpis`, `overview_revenue_daily`, `overview_top_ads` — IST day windows (`p_days` null = all time), L1 from `v_payments_attributed` (paid), L2 from `external_payments` (`status='captured'`, dated `coalesce(paid_at, created_at)`), grouped by `ad_key` **including the NULL bucket**, L1/L2 in separate CTEs joined after (fan-out guard). Tests: `tests/{format,client-selection,overview-rpcs}.test.ts` — 163 total green, including SDK-oracle reconciliation, range monotonicity, tenant scoping (other-tenant → zeros, anon → error), and the ad_key-not-ad_name grouping premise.

**Design system v2 (commit `555e45a`)** — full restyle adopting **Trace's own dark glass admin system 1:1**: slate-950/900 gradient canvas, white/5 glass cards + backdrop blur, white/10 hairlines, indigo-only accent, slate text ladder, zero shadows, dark-only. Done as a token remap in `globals.css` (names unchanged, values only). Sharan's design doc committed verbatim at `docs/design-system/trace-design-system.md` (canonical); dashboard extensions + contrast notes in `docs/superpowers/specs/2026-08-10-visual-design-system-v2-dark.md` (supersedes the 2026-08-08 light spec). Inter and iconsax-react **removed** (Geist-only sans; StatusBadge is now lucide icon + colored text, no pill). `--radius: 0.625rem`. IA/Overview design spec: `docs/superpowers/specs/2026-08-10-dashboard-ia-and-overview-design.md`.

## Decisions made

- **Single-client view only** — no "all clients" mode. Cookie `trace_client_id`, re-resolved every request against the caller's RLS-visible client list (stale/forged cookie can never widen access); default Love School by name. Date range is a URL param `?range=7d|30d|all` (default 30d).
- **All aggregation in Postgres RPCs** (`security invoker`; `p_client_id` is defense-in-depth, RLS is the guarantee). Never page rows into JS to sum in app code (test oracles may).
- **L2 dedupe guard in SQL**: exclude `external_payments` rows whose `external_order_id` matches a `payments.order_id` for the same client. Verified a no-op today; stays for backfill safety.
- **Meta-derived metrics (Spend, CPA, chart Spends/CPA tabs) are locked "Connect Meta" placeholders** — dormant styling, never fake zeros.
- **Chart hero is L2** (indigo-400 2px, the 1.6× story); L1 is the slate-400 baseline; the table's L2 column is indigo-300. Deliberate emphasis inversion — do NOT "fix" back. Only remaining color question: a >2-series categorical palette.
- KPI value at `text-4xl` is a recorded dashboard extension of the design doc's `text-xl` "big number".

## Problems solved

- **Postgres cannot FULL JOIN on `IS NOT DISTINCT FROM`** ("only supported with merge-joinable conditions") — join on `coalesce(key, '__unattributed__')` sentinel equality instead (`overview_top_ads`).
- **`next build` failed prerendering** because the root-layout AppShell hit Supabase before anything marked routes dynamic. Fix: `await cookies()` FIRST in AppShell. Related: `<main>` must NOT have `bg-background` — an opaque main paints over the body gradient and kills every backdrop-blur.
- **recharts 3.8 works on React 19 as-is** — the planned `react-is` override was a 2.x-era need, not required.
- **Playwright harness** (no chromium-cli on this Mac): `playwright-core` installed in the session scratchpad, launched against the cached browser at `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
- **Occultyogis' two ₹99 external rows**: `external_order_id` matches NO `payments.order_id` and they carry distinct product names ("Energy Vastu - BRE/GCFB") — likely genuine L2, not re-imports. The SQL guard covers any future provable duplicates.
- The dark "N" circle overlapping the client switcher in dev screenshots is the **Next.js dev-tools badge**, not our UI.

## Current state

`main` pushed through `555e45a`; typecheck, 163 tests, and production build all green; browser-verified at 1440px/375px with zero console errors. All-time Love School through the UI: **L1 ₹46,442 (480 paid) · L2 ₹97,242 (10)** — reconciled exactly against direct SQL.

Still-open data caveats (unchanged from before): `product_name` null on 10/12 external payments (all real Love School L2 revenue — classification blocked); only 12 external rows (partial import 12 Jul–8 Aug, captioned in UI); **the L2 schema (`customers`, `external_payments`, `sync_runs`, `payments.customer_id`, two views) is still in no repo's version control**; Slice B's Meta sync log must be named `ad_sync_runs` (`sync_runs` is taken — recorded in STATUS.md).

## Next session starts with

**Build the Ads page (`/ads`)** — the campaign → ad set → ad expandable hierarchy table (ONE page, three zoom levels, per the IA spec). It inherits design system v2 for free. Will need new aggregate RPC(s) at adset/campaign tiers — same pattern as `overview_top_ads` but grouped by `adset_key`/`campaign_key` from the attributed views; reuse `groupWithUnattributed` + `tierKeyOf` from `src/lib/metrics/attribution.ts`. Spend/ROAS/CPA columns render as locked placeholders until Meta connects.

Quick first check: ask Sharan if the hero tint (`border-indigo-500/30` + `bg-indigo-500/6`) and L2 indigo intensity look right in his browser — both are one-line token/class tweaks.

## Open questions

- Backfill the rest of Razorpay history (12 external rows today) — runs through Trace, not this repo.
- Fix `product_name` capture for Love School or L2 classification can't work for the client that matters.
- Capture the L2 schema into a migration in whichever repo owns it.
- Meta App Review chain unchanged: Business Verification → `ads_read` Advanced → System User → per-client grants (Occultyogis first — unlocks names for 2,342 sessions). Seed Occultyogis into `ads` from an Ads Manager export before then.
- The `#`-fragment capture bug in Trace (5 of ~964 paired rows).
- Chart categorical palette for >2 series (the only remaining color decision; dark mode is resolved — the app IS dark).

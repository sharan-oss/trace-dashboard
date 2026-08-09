# Dashboard IA & Phase 1 Overview — Design

Approved by Sharan on 2026-08-10 (brainstormed and built the same day).
Status: **Overview shipped**; Ads / Customers / Funnel are designed at the
IA level only and stubbed in the app.

## Information architecture — one page per decision

Approach chosen: each section answers exactly one decision. Alternatives
considered and rejected: one page per entity (7 pages, none decides
anything alone) and a single mega-overview (kills glanceability).

| Section | Route | Decision it drives | Read layer |
|---|---|---|---|
| Overview | `/` | Business health at a glance | `overview_*` RPCs |
| Ads | `/ads` | Scale or kill (campaign → ad set → ad as ONE page with an expandable hierarchy, not three pages) | `v_payments_attributed`, `v_sessions_attributed`, `ads` |
| Customers | `/customers` | Acquisition quality — L2/LTV per acquiring ad | `customer_spend`, `customers`, `customer_payments_unified` |
| Funnel | `/funnel` | Where visitors leak | `v_funnel_by_session` |

**Single-client view only.** There is no "all clients" mode. The client
switcher lives in the left sidebar (Meta ad-account-picker style: CLIENT
overline, name over a mono id subtitle, check on the active row). The
selection is a cookie (`trace_client_id`), re-resolved on every request
against the caller's RLS-visible client list — a stale or forged cookie can
never widen access. Default: Love School by name match, else first visible
client. When Phase 2 client auth ships, a client login simply sees a
one-entry list.

**Date range** is page state, not a preference: `?range=7d|30d|all`,
default `30d`, so views stay shareable. IST day semantics live only in SQL.

**Meta-derived metrics (Spend, CPA, and the Spends/CPA chart tabs) are
locked placeholders** — "—" plus "Connect Meta to unlock", never fake
zeros — until the Meta account connects (blocked on `ads_read` App
Review). The layout already holds their slots so nothing reflows later.

## Overview page (shipped)

Top to bottom:

1. **KPI tiles** (BentoGrid, six 1×1): Total spend (locked) · L1 revenue
   with paid-transaction count in brackets · L2 revenue with count,
   captioned "partial import — backfill pending" · CPA (locked) · Sessions ·
   Conversion rate (the named metric — never plain "conversion").
2. **Revenue chart card**: segmented tabs Spends | L1 + L2 Revenue | CPA.
   Revenue is live and default — daily L1/L2 lines, gap-filled with
   truthful zeros, greyscale only (L1 `--chart-5` 2px, L2 `--chart-2`
   1.5px; the categorical palette stays deferred). Locked tabs are
   disabled, no empty charts behind them.
3. **Top performing ads**: top 5 by attributed L1+L2 revenue via
   `groupWithUnattributed`, muted Unattributed row last when nonzero.
   Ad names are NOT unique, so campaign renders as a subtitle and a short
   mono ad-id suffix is appended whenever a rendered name repeats. Footer
   links to `/ads`.

## Data contract — three aggregate RPCs

`supabase/migrations/20260810100000_overview_aggregate_rpcs.sql`:
`overview_kpis`, `overview_revenue_daily`, `overview_top_ads` — all
`security invoker` (RLS is the guarantee; `p_client_id` is
defense-in-depth), execute revoked from `anon`, all aggregation in
Postgres. L2 rules encoded there:

- Counted rows are `external_payments.status = 'captured'` (mirrors
  `customer_payments_unified`), dated `coalesce(paid_at, created_at)` IST.
- **Dedupe guard**: rows whose `external_order_id` matches a
  `payments.order_id` for the same client are excluded. Verified live
  2026-08-10: zero matches today (including Occultyogis' two ₹99 rows,
  which carry distinct product names and may be genuine L2) — the guard is
  a deliberate no-op that stays correct as the Razorpay backfill arrives.
- **L2 credit rule**: `external_payments → customers.l1_payment_id →
  v_payments_attributed.ad_key` — the ad behind the first L1 purchase.
- Top-ads groups by `ad_key` including the NULL (Unattributed) group;
  L1 and L2 aggregate in separate CTEs joined afterwards (join-then-sum
  fans out).

Tests: `tests/overview-rpcs.test.ts` reconciles every RPC against
SDK-side oracles, proves range monotonicity, tenant scoping through the
client SDK (other-tenant → zeros, anon → error), and the
name-vs-key grouping premise. `tests/format.test.ts` and
`tests/client-selection.test.ts` cover the pure layers.

## Verified on ship day

Browser-checked at 1440px and 375px (BentoTile responsive-span fix
included), zero console errors. On-screen all-time Love School figures
reconciled exactly against direct SQL: L1 ₹46,442 (480 paid), L2 ₹97,242
(10 captured, guarded). L2 remains a partial import (12 Jul – 8 Aug) and
is captioned as such wherever it appears.

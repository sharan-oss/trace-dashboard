# Customers section — Value tab (v1) + People tab (v2)

**Date:** 2026-08-16
**Status:** both built and shipped same day (v1 approved section-by-section; v2's
decisions recorded in the addendum at the bottom)
**Route:** `/customers?tab=value|people`

## Why this page exists

`/customers` and `/funnel` are the last two stubs in the IA settled on 2026-08-10. The Ads
section answers the media buyer's question — *which ad do I scale?* — through ROAS (L1+L2)
per campaign and per creative. Nothing in the dashboard answers the owner's question:

> **Is this machine profitable? Can I afford to feed it more?**

That question is what justifies Trace's price. No other tool in these clients' stacks can
compute it, because the revenue that decides it arrives on a bare Razorpay payment link days
after the ad click, and only Trace links it back — through the `customers` identity spine
(email/phone match) and the `external_payments` sync.

### What the live data says (queried 2026-08-16, all time)

| | Love School | Occultyogis Vastu |
|---|---|---|
| Customers | 548 | 598 |
| Bought once | 534 | 576 |
| Bought again | **14 (2.6%)** | **22 (3.7%)** |
| First-purchase revenue | ₹54,659 / 563 payments (~₹97 avg) | ₹59,507 / 609 (~₹98 avg) |
| Upsell revenue | ₹97,242 / 10 payments (~₹9,724 avg) | ₹94,283 / 20 (~₹4,714 avg) |
| Median days first → second | 3.4 | 2.5 |
| Customers tracing to an ad | 520 / 548 (95%) | no `ads` rows yet |

Both clients run the same machine: a ~₹99 tripwire, then a high-ticket upsell about three
days later. **~3% of customers produce ~64% of revenue.** Every decision below follows from
that fact. This page is an argument about where the money is, not a CRM.

Two live conditions the design must handle rather than hide:

- Love School's Meta spend is **₹6,02,074** (both accounts, 06-27 → 08-15) against
  **₹1,51,901** of recorded customer value: CAC ₹1,099, avg LTV ₹277, **LTV:CAC 0.25×**. The
  Ads page already renders that same 0.25× as ROAS, so it is not a new claim — but on a page
  *about* customer value it reads as a verdict, and it is understated by an unknown amount
  because only 10 external payments have ever been imported (12 Jul – 6 Aug).
- Occultyogis has **zero `ad_insights_daily` rows**, so every spend-derived metric must
  degrade to `n/a`.

## Decisions

1. **The page's job is economics.** Owner/CFO view. Media-buyer scaling stays on `/ads`.
2. **Range means acquisition cohort.** Customers whose *first* purchase falls in range, with
   their value counted in full — including upsells that land after the range ends. CAC and
   LTV then describe the same people, which is the only arrangement where LTV:CAC is
   arithmetically honest. The ~3-day upsell median means cohorts mature within a week.
3. **LTV is lifetime-to-date**, not a bounded LTV-30. One number, no new concept. The single
   distortion — customers acquired in the last 7 days have not had their upsell window yet —
   is handled by a maturity note, not a second metric.
4. **LTV:CAC is shown truthfully, with a computed coverage line** ("Backend import partial:
   10 payments, 12 Jul – 6 Aug"). A premium tool that hides an unflattering number is Ads
   Manager; one that states it alongside its coverage is an auditor.
5. **v1 is the Value tab only.** The People tab (paged customer list, purchase timelines) is
   v2, behind the same `?tab=` scaffold.
6. **Architecture: one definitional view + thin RPCs** (below), chosen over per-RPC joins
   (drift risk) and a precomputed summary table (over-engineering at 600 rows).
7. **Avatars: DiceBear v10, generated locally server-side**, seeded by customer UUID.

## Data layer

### Migration 1 — adopt the L2 schema

`customers`, `external_payments`, `sync_runs`, `customer_spend` and
`customer_payments_unified` were created directly against the live database on 2026-08-09 and
exist in **no repository's migrations**. This repo already owns a migration that ALTERs them
(`20260810090000_l2_tables_rls_and_view_invoker.sql`), so it adopts them here: their current
DDL captured as guarded no-ops (`create table if not exists`, views recreated to their exact
current definitions). Nothing changes on the live database; the objects simply stop being
undefined. Everything below depends on them.

### Migration 2 — `v_customers_attributed`

`security_invoker = on`, select revoked from `anon`, granted to `authenticated` — the same
lockdown the definition probe carries. This is the object class that leaked 652 rows across
two tenants on 2026-08-09; the invoker flag is not optional.

`customer_spend` joined through `customers.l1_payment_id → v_payments_attributed`, emitting
per customer: acquiring `ad_key` / `ad_name` / `campaign_key` / `campaign_name`, lifetime
value in paise, purchase count, `first_paid_at`, `last_paid_at`, `days_to_second`.

**The customer → acquiring-ad join is defined here once.** Every consumer composes it, so the
KPI row, the acquisition table and the future People tab cannot drift apart — the same
discipline `v_ad_name_resolution` established for ad names.

### Migration 3 — four RPCs

All `(p_client_id uuid, p_days int default null)`, `security invoker`, `set search_path =
public`, IST day windows, `p_days` null = all time, cohort filter on `first_paid_at`:

| RPC | Returns |
|---|---|
| `customers_kpis` | cohort size, repeaters, cohort lifetime value, first-purchase vs repeat revenue split, Meta spend in window, median days to second purchase, immature count (<7 days old), L2 coverage (external row count + min/max paid day) |
| `customers_by_ad` | per acquiring ad: customers, repeaters, cohort LTV, that ad's spend in window. Null-key Unattributed row always present |
| `customers_ladder` | ordinal 1 / 2 / 3+: customers reaching it, revenue, average order value |
| `customers_top` | top N by lifetime value: id, name, LTV, purchases, acquiring ad name, days to second |

RPCs return counts and paise only. Every ratio is computed in TypeScript through the existing
`ratio()` helper, which returns `null` rather than `NaN` or `Infinity`.

## Read and metrics layer

- `src/lib/queries/customers.ts` — mirrors `queries/ads.ts`: a private `rpcRows` helper and
  one exported typed function per RPC.
- `src/lib/metrics/definitions.ts` — add `CAC_LABEL`, `LTV_CAC_LABEL`, `REPEAT_RATE_LABEL`
  and pure `cac()`, `ltvCac()`, `repeatRate()` beside the existing `roas`/`cpa`/`ctr`/`cpm`.
- `src/lib/avatars.ts` — `@dicebear/core` v10, pure `avatarSvg(customerId)`, deterministic.
  **Seeded by customer UUID only** — never email or phone, so no personal data reaches a
  third party or appears in any URL, and a customer's face stays stable forever.

## Page

`src/app/(dashboard)/customers/page.tsx` — server component, `force-dynamic`, same client
cookie and range resolution as `/ads`. Blocks top to bottom, components in
`src/components/customers/`:

1. **KPI bento** (reusing `KpiTile` / `BentoGrid`): New customers · Repeat rate · Avg LTV
   (with maturity caption when the range touches the last 7 days) · CAC · **LTV:CAC** with
   the computed coverage line · Median days to upsell.
2. **`value-concentration-bar.tsx`** — one full-width split bar: first-purchase revenue in
   slate-400 against repeat revenue in indigo-400, amounts and counts on each half. The whole
   thesis at a glance. Deliberately not a chart; Overview owns the time series.
3. **`top-customers-strip.tsx`** — the ~8 highest-LTV customers as small cards: avatar, name,
   LTV, purchase count, "via [ad name]". Makes concentration visceral — the revenue is these
   people. The v1 home of the avatars.
4. **`acquisition-table.tsx`** — per acquiring ad: Customers · CAC · Repeat (count *and*
   rate) · Cohort LTV · LTV:CAC. Unattributed as a real row; footer totals reconcile to the
   KPI tiles exactly.
5. **`customers-tabs.tsx`** — `?tab=value` scaffold; People arrives in v2.

The build renders a strip of 3–4 DiceBear styles against the dark glass background for Sharan
to choose before the strip component is finished — visual choices go to him, per the standing
workflow rule.

## Precision rules

These are structural, not decorative: they are the difference between a dashboard and a
number generator.

- Every rate renders its counts beside it ("2 (7%)"). Any ratio whose denominator is below 20
  renders muted with a "too few customers to read" tooltip. A page announcing a 100% repeat
  rate off n=1 is worse than one that says nothing.
- No spend rows for the client → CAC and LTV:CAC render `n/a`, never 0 or ∞.
- Cohort members younger than 7 days are counted but flagged.
- Reconciliation invariants: `customers_by_ad` rows + Unattributed = `customers_kpis` cohort
  size; ladder revenue sum = cohort lifetime value; concentration bar halves = the same total.
- Any un-ranged read of a table is paged. PostgREST's 1000-row cap has silently truncated
  reads in this repo three times already.

## Tests

`tests/customers-rpcs.test.ts` and `tests/avatars.test.ts`, ~12 tests, live database through
real RLS-scoped JWTs, asserting relationships rather than absolute counts:

- every reconciliation invariant above;
- SDK-oracle check of one customer's LTV against raw `customer_spend`;
- tenant scoping — other-tenant identity sees zeros; `anon` is refused by the view **and**
  by every RPC (the regression class of the 2026-08-09 leak);
- range monotonicity;
- cohort boundary: a customer acquired before the range whose repeat purchase lands inside it
  is excluded;
- avatar determinism: same UUID → identical SVG.

## Verification

1. `npm run typecheck` and `npm test` green (235 → ~247).
2. `npm run build && npx next start` — interactivity is verified against `next start`, never
   `next dev` (HMR websocket is broken in the sandboxed environment).
3. Browser at 1440px and 375px, zero console errors.
4. On-screen against direct SQL: Love School all time = 548 customers, 14 repeaters,
   ₹1,51,901 total; acquisition rows + Unattributed = 548; ladder rows sum to ₹1,51,901.
5. Switch to Occultyogis: CAC and LTV:CAC read `n/a` and the page renders fully without spend.
6. Same UUID renders the same avatar across reloads.

---

## Addendum — People tab (v2, built 2026-08-16, same day)

Decisions locked with Sharan: tab named **People** (over "Buyers"/"Directory"); full detail
sheet included; device/network data **in the sheet only** — the table stays pure economics,
and aggregated audience-quality analysis stays reserved for the Funnel section. Plus one
request from the v1 review: every ad name in the section shows its creative on hover.

**People table** (`?tab=people`): one row per cohort customer — avatar + name + email,
acquired-via ad, IST first-purchase day, purchases, days to upsell, LTV. Server-paged at 50
off `v_customers_attributed` (`getCustomersPage`), with search (name/email, input sanitised
against PostgREST or-syntax), sort (Highest LTV / Newest / Fastest to upsell, best-first
defaults, explicit direction toggle), and a repeat-buyers switch — all state in the URL, all
filtering server-side. The cohort cutoff reuses `rangeStartDay()`, and a test pins the page
total to `customers_kpis.cohort_customers` for every preset so the two tabs can never
disagree about who exists.

**Customer sheet** (`?customer=<id>`, so a person's story is a shareable URL): base-ui
Dialog as a right panel (chosen over Drawer — Drawer's anatomy is a swipeable bottom-sheet
stack). Header identity, LTV hero, full purchase timeline ("Trace checkout" vs
"Payment link" origin badges, null products render "—"), first purchase marked "via <ad>",
and a first-visit context line (device brand/model/os · network kbps · visits before
buying) from the acquiring session. Esc/backdrop close by clearing the URL param.

**Ad previews** (`AdPeek`, base-ui PreviewCard): hover/tap any ad name → portal popup with
the 720px creative, ad name, campaign. Signed URLs minted server-side only for the ad keys
on screen (`src/lib/creatives.ts`, shared with /ads — its signing logic was extracted
there). Missing dimension row (Occultyogis) → the popup opens and says "No creative
synced"; a hover that silently does nothing reads as broken. Retrofitted onto the Value
tab's top-customers strip and acquisition table.

Verified live same day: 548/598/2 totals match the KPI cohort; pages disjoint; hover pops
the real creative on both tabs; sheet timeline sums to the LTV shown; Esc cleans the URL;
zero console errors at 1440/375. 276 tests.

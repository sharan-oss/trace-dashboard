# Ads Section Restructure — Campaigns | Ads (2026-08-13)

Approved design for reorganizing `/ads` from the Slice D single drill-down table into
two sub-views, the way Meta Ads Manager and creative-analytics tools structure it:
a **Campaigns** overview table for budget decisions and an **Ads** view of creative
cards for ad-level decisions, with campaign-click drill-through between them.

Companion implementation plan lives in the session plan file; this doc records the
decisions and their reasoning so they survive the session.

## Decisions

1. **Ad sets are demoted** — no aggregate level anywhere. The ad-set name appears as
   a chip on each ad card and as a filter in the Ads view. Rationale: budget and
   creative decisions happen at campaign and ad level for this account structure;
   an ad-set tier was a third aggregate view nobody made decisions at.
2. **Campaign row metrics:** Spend · L1 revenue (+txn count) · L2 revenue (+count) ·
   ROAS (L1+L2) · CPA (L1). CPA chosen as the fifth metric over CTR/sessions/conv-rate:
   ROAS tells you efficiency, CPA tells you scalability — together they are the
   budget-decision pair.
3. **Ad card carries:** creative thumbnail, ad name, ad-set chip, status badge
   (active / paused / inactive), Spend, L1 (+n), L2 (+n), ROAS, CPA, **CTR, CPM**.
   CTR/CPM are unlocked from `ad_insights_daily.impressions/clicks`, which the sync
   already stores but no RPC surfaced. Deliberately deferred: per-ad spend sparkline
   and sessions/conv-rate (softens the money focus; natural next slice alongside a
   card-click detail view).
4. **Naming:** sidebar stays **"Ads"**; sub-tabs are **Campaigns | Ads** — Meta Ads
   Manager's own tab names, instantly familiar. The name echo is acceptable (Meta
   does the same). No sidebar rename.
5. **Architecture:** one route, URL-param views —
   `/ads?tab=campaigns|ads&campaign=<key>&range=…`. No nested routes: both views
   share the same fetches, one loading skeleton, one error boundary, and the
   campaign→ads handoff is a plain link. Converts mechanically to nested routes
   later if a third view ever appears.
   Local refinements (ad-set filter, status filter, name search, sort,
   zero-activity toggle) are client state, not URL params.
6. **KPI tiles live on the Campaigns tab only** (it is the "campaign overview").
   The Ads tab gets a **filtered-total strip** — "{n} ads · spend · L1 · ROAS · CPA"
   recomputed from the currently filtered card set.
7. **Accuracy guarantees survive unchanged:** the Campaigns table keeps the
   Unattributed row and both reconciliation footer rows ("Spend, no tracked
   sessions" / "Unattributed revenue"). The Ads view shows an unattributed **banner**
   (never a fake card), and only when no campaign filter is active — unattributed
   revenue by definition belongs to no campaign.
8. **CTR = clicks ÷ impressions, CPM = spend ÷ impressions × 1000** — pure
   Meta-native math with no attribution logic, so both are exact by construction.
   Null (rendered `n/a`) on zero denominator, same contract as `roas()`/`cpa()`.

## Data-layer delta

- `ads_breakdown` is dropped and recreated (return type changes): grouping sets go
  from three to two — `((campaign), (campaign, adset, ad))`, `tier ∈ {campaign, ad}` —
  and `impressions bigint` / `clicks bigint` sums are added from `ad_insights_daily`.
  Ad rows keep `adset_key`/`adset_name` as grouping columns for the chip and filter.
  Everything else (IST windows, `security invoker`, null-key Unattributed groups via
  GROUP BY, `name_matched`, `has_test`, grants) carries over verbatim.
- `ads_summary` and `overview_spend_daily` untouched; the Overview page is unaffected.
- The Ads view merges breakdown ad rows with a full `ads`-dimension read (paged past
  PostgREST's 1000-row cap) so paused/zero-activity ads can appear behind a
  "show zero-activity ads" toggle. Default card set = ads with in-range activity,
  spend-descending.

## Known constraints honored

- `date-range-picker` must preserve other URL params (today it rebuilds `?range=`
  from scratch) — fixed as part of this work.
- Thumbnails come from the private `ad-creatives` bucket via chunked signed URLs.
- Tests stay live-DB through RLS-scoped JWTs, asserting relationships not counts;
  the 10 `ads_breakdown` invariant tests are updated for the two-tier shape plus
  impressions/clicks invariants.

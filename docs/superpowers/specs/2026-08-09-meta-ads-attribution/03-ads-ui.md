# 03. Ads UI: campaign to ad set to ad drill down

Child of [index.md](index.md). Depends on [01-metrics-foundation.md](01-metrics-foundation.md) and [02-meta-ads-sync.md](02-meta-ads-sync.md).

## Summary

This is the Ads section of the dashboard. It starts with a summary of spend, revenue and return on ad spend, then lets you drill from campaign to ad set to individual ad, with the creative image shown alongside each ad. It is honest about what it does not know: spend on ads that produced no tracked visits, and revenue that cannot be traced to an ad, each get their own visible row rather than being quietly dropped.

## Requirements

Satisfies **AC-16** to **AC-19** from [index.md](index.md).

## Design

### Structure

A new top level `Ads` section. The project now has more than five top level areas, so this is the point at which sidebar navigation is warranted per the project UX principles.

Three levels, progressive disclosure, summary first:

1. **Summary**: bento tiles showing total spend, total revenue, ROAS, CPA and conversion rate for the selected range.
2. **Campaign table**: one row per campaign, expandable to ad sets, expandable to ads.
3. **Ad row**: creative thumbnail, ad name, spend, revenue, ROAS, CPA, conversion rate, and a weak match marker where applicable.

### Metrics per level

| Metric | Formula | Notes |
|---|---|---|
| Spend | Sum of `ad_insights_daily.spend_minor` | Meta only. Label it Meta spend, not total spend |
| Revenue | Sum of `payments.amount` where paid | Trace only. Never a Meta reported figure |
| ROAS | Revenue divided by spend | Both already in paise, so no unit conversion |
| CPA | Spend divided by count of paid payments | Show as not applicable when there are zero conversions, never as infinity or a dash that reads as zero |
| Conversion rate | Paid payments divided by sessions | Uses the child 01 definition |

### Reconciliation rows

Two rows always present, even at zero, so their absence never reads as "there is no gap":

- **Spend, no tracked sessions**: ads with spend whose `meta_ad_id` matches no session. Revenue column shows not applicable, not zero.
- **Unattributed revenue**: paid payments whose `ad_key` resolved to nothing, or resolved to an ad not present in `ads`. Spend column shows not applicable.

The invariant: the spend column totals real spend and the revenue column totals real revenue, both including these rows.

### Honesty markers

- A row joined by ad name rather than ad identifier carries a visible marker. Love School has zero ad identifiers on sessions, so their entire ad level view is name matched and must say so. Their campaign level view is sound and needs no marker.
- Rows attributed at campaign tier only (a campaign key but no ad key) appear in campaign rollups normally and in the ad level Unattributed bucket, per child 01. The campaign row's detail may state how much of its revenue is campaign tier only.
- A Test badge on rows where `is_test_payment OR is_test_client` from child 01 is true, using the existing `StatusBadge` component. One rule, one badge.
- A stale data notice per ad account, keyed on the newest `sync_runs` row with a non null `finished_at`. A currently `running` row shows as sync in progress, which is distinct from stale. A client with two accounts sees which one is behind.
- The date range control must make clear that Occultyogis onboarded on 2026-07-30, so an all time comparison against Love School spans different periods.

### Visual system

Built on the existing design system in `docs/superpowers/specs/2026-08-08-visual-design-system.md`: navy ink tokens, off white canvas, bento tiles, hairline borders, no shadows. Colour carries semantic status only, so ROAS must not be colour coded good or bad without a status meaning behind it.

Charts use shadcn chart components on Recharts, as already decided. This is the first feature needing a categorical palette for multiple series, which that spec explicitly deferred. It must stay visually distinct from the three semantic status colours, and it is a decision to bring to Sharan rather than pick during the build.

### States

Empty (no ad account connected yet, with a link to the mapping screen), loading, error, sync in progress, and synced but zero spend in range. These are five visibly different things and must not collapse into one blank table.

### Access

Admin sees all clients with a client switcher. A client sees only their own rows, enforced by row level security rather than by application filtering. The account mapping screen is admin only.

## Build plan

1. Ads route and sidebar navigation, with empty, loading and error states, satisfies **AC-16**.
2. Summary bento tiles, satisfies **AC-16**.
3. Campaign to ad set to ad drill down, satisfies **AC-16**.
4. Spend, revenue, ROAS, CPA and conversion rate per level from Trace payments, including campaign tier fallback rows, satisfies **AC-16**, **AC-17**, **AC-20**.
5. Reconciliation rows for unmatched spend and unattributed revenue, satisfies **AC-18**.
6. Creative thumbnails via signed URLs from the private bucket, satisfies **AC-11**.
7. Weak match marker and Test badge, satisfies **AC-19**.
8. Stale data notice driven by `sync_runs`, satisfies **AC-13**.
9. Verify a client JWT sees only its own ads, satisfies **AC-6**.

## Rationale

A separate Ads section rather than extra columns on the revenue overview, because mixing payment data and ad data in one wide table works against the project's summary first principle, and because the natural shape of ad data is a hierarchy rather than a flat list.

Reconciliation rows are shown rather than hidden because the alternative silently understates spend, which makes agency wide ROAS look better than reality. A dashboard that flatters is worse than one that admits a gap, particularly when the gap itself is the actionable signal that tagging needs fixing.

Not applicable rather than zero for missing values, because a zero in a revenue column reads as "this ad failed" when the truth is "this ad was not tracked", and those imply opposite actions.

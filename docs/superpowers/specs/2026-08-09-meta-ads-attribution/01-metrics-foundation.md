# 01. Metrics Foundation: normalized read layer over existing data

Child of [index.md](index.md). Buildable now, no Meta dependency.

## Summary

This adds a read layer of database views over Trace's existing tables that fixes what the raw data means, without changing a single stored row. It merges duplicate traffic sources caused by a tagging bug, marks test transactions so they stop quietly inflating revenue, names the two different conversion rates separately, and works out which ad a session or payment belongs to even though the two paying clients tag their ads completely differently.

Nothing here needs a Meta account, a credential or an external approval, so it can ship immediately and unblocks the Phase 1 revenue overview.

## Requirements

Satisfies **AC-1** to **AC-6** from [index.md](index.md).

## Design

All logic lives in Postgres views. This dashboard never writes to `clients`, `products`, `sessions`, `events` or `payments`.

### View: `v_sessions_attributed`

Over `sessions`. Adds:

| Column | Rule |
|---|---|
| `utm_source_clean` | Strip a leading `utm_source=` from `utm_source`. Applies to 1,588 rows today |
| `ad_key` | The shared extraction rule below against `landing_url`, then `utm_content` |
| `ad_key_type` | `ad_id` when an identifier matched, `ad_name` when `utm_content` was used, `none` otherwise |
| `campaign_key` | `utm_id` from the shared extraction rule, else null |
| `day_ist` | `created_at` converted to Asia/Kolkata, cast to date |

**Shared extraction rule, identical on both views.** The ad identifier is the first non null of the variants `h_ad_id`, `ad_id`, `Ad_id`, `Ad ID`, matched case insensitively against URL decoded values. On sessions the source is the `landing_url` query string; on payments it is the `utm_params` keys. The variant list is one definition used by both sides, so a variant appearing on a new side later cannot silently break the join.

Use anchored regular expressions, never `LIKE '%h_ad_id%'`. In SQL `LIKE` and `ILIKE`, `_` is a single character wildcard, so `'%fbc_id%'` matches `fbclid` and silently overreports coverage. This mistake was made and caught during profiling.

### View: `v_payments_attributed`

Over `payments`, joined to `clients` for the test account signal. Adds:

| Column | Rule |
|---|---|
| `utm_source_clean` | Same prefix strip as above. 147 rows today |
| `ad_key` | The shared extraction rule above against `utm_params` keys, then `utm_params->>'utm_content'` |
| `ad_key_type` | `ad_id`, `ad_name`, or `none` |
| `campaign_key` | `utm_params->>'utm_id'` |
| `is_paid` | `status = 'paid' OR paid_at IS NOT NULL`. Four rows are paid with a null `paid_at` |
| `is_test_payment` | `amount <= 500` (Rs 5 in paise) |
| `is_test_client` | `clients.razorpay_key_id LIKE 'rzp\_test%'` with the underscore escaped |
| `day_ist` | `COALESCE(paid_at, created_at)` converted to Asia/Kolkata, cast to date |

Only these four `utm_params` keys are ever read by name. The key space is unbounded because campaign names leak into it as keys, so nothing may enumerate keys generically.

### View: `v_funnel_by_session`

Over `events`. One row per session with a boolean per stage, computed as **reached this stage or any later stage**, not as "fired this event". Real data has 294 sessions reaching `form_start` without `form_open` and 72 reaching `payment_complete` without `form_open`; counting raw events makes later stages exceed earlier ones and inverts the drop off chart.

### Metric definitions

Both are exposed, separately named. Neither may be labelled simply "conversion rate".

| Metric | Formula | Today |
|---|---|---|
| Conversion rate | paid payments divided by sessions | 5.68% Love School, 5.81% Occultyogis |
| Checkout completion | paid payments divided by all payment attempts | 65.3% Love School, 54.2% Occultyogis |

### Two tier attribution

The join runs in two tiers, per the cross child contract in [index.md](index.md):

1. **Ad tier**: `ad_key` matches `ads.meta_ad_id` when `ad_key_type` is `ad_id`, or `ads.ad_name` when it is `ad_name`. Once child 02 populates `ads`, a name match resolves through that table to a real `meta_ad_id`, upgrading historical name matched rows to identifier joins at read time. When the row also carries a `campaign_key`, the name lookup is scoped to ads within that campaign (`ads.meta_campaign_id = campaign_key`), which disambiguates a name reused across campaigns. The rename caveat remains for history.
2. **Campaign tier**: a row with no resolvable `ad_key` but a non null `campaign_key` matches `ads.meta_campaign_id` and counts in campaign level rollups, marked attributed at campaign level only. This is what keeps Love School's 94% campaign coverage out of the Unattributed bucket at campaign level.

### Unattributed bucket

Any breakdown grouping by `ad_key` or `campaign_key` must emit an explicit `Unattributed` row for rows resolving nothing at that tier, rather than filtering them. Applies to 16 payments with no `session_id`, plus every row where no key resolved. A campaign tier row is attributed in campaign rollups and Unattributed in ad rollups; both statements are true and both must hold. The invariant is that grouped rows plus Unattributed equals the ungrouped total at every tier.

### Security

Views inherit row level security from their base tables. Create them with `security_invoker = true` so the querying user's policies apply, rather than the view owner's. Verify explicitly under both a client JWT and an admin JWT, since a view that bypasses row level security is a tenant data leak.

## Build plan

1. Create `v_sessions_attributed` with `security_invoker`, satisfies **AC-1**, **AC-4**.
2. Create `v_payments_attributed`, satisfies **AC-1**, **AC-2**, **AC-4**.
3. Create `v_funnel_by_session` using reached or beyond semantics, satisfies **AC-3**.
4. Expose both named metrics in the query layer, satisfies **AC-3**.
5. Add the campaign fallback tier and the Unattributed bucket to every grouping helper, satisfies **AC-5**, **AC-20**.
6. Verify all views under a client JWT and an admin JWT, satisfies **AC-6**.

## Rationale

Views rather than stored columns, because this dashboard is forbidden from writing to Trace's tables and because a view corrects all history at once with no backfill. The cost is that the repair runs on every read and that bad rows keep arriving until Trace's capture is fixed, which is tracked as a follow up.

The test threshold sits on the payment rather than the product because test products get repriced to their real value after testing. `payments.amount` is sourced server side at payment time, so those rows keep the Rs 1 value permanently, which makes the payment level rule correct retroactively and free of upkeep.

Both conversion rates are exposed because they answer different questions: sessions to paid measures the ad and the landing page, attempts to paid measures the checkout. Publishing only one would hide either ad quality or a payment gateway problem.

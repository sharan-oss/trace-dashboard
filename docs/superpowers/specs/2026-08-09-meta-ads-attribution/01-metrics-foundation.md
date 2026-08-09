# 01. Metrics Foundation: normalized read layer over existing data

Child of [index.md](index.md). Buildable now, no Meta dependency.

## Summary

This adds a read layer of database views over Trace's existing tables that fixes what the raw data means, without changing a single stored row. It merges duplicate traffic sources caused by a tagging bug, marks test transactions so they stop quietly inflating revenue, names the two different conversion rates separately, and works out which ad a session or payment belongs to even though the two paying clients tag their ads completely differently.

Nothing here needs a Meta account, a credential or an external approval, so it can ship immediately and unblocks the Phase 1 revenue overview.

## Requirements

Satisfies **AC-1** to **AC-6** from [index.md](index.md).

## Design

All logic lives in Postgres views. This dashboard never writes to `clients`, `products`, `sessions`, `events` or `payments`. (The one deliberate, Sharan directed exception already happened: the 2026-08-09 one time normalisation added three nullable columns, `campaign_id`, `adset_id`, `ad_id`, to `sessions` and `payments` and backfilled them for Love School only. See "Stored ids and the backfill" below. The views read those columns first and never write anything.)

### Proven slot semantics (verified against Meta's own hierarchy export)

These were confirmed by classifying every observed value against Love School's real Ads Manager export, with zero cross tier collisions:

| Raw slot | Actually carries |
|---|---|
| `utm_id`, `campaign_id` param | the Meta campaign id |
| `utm_term` when it passes the numeric guard | the Meta adset id (one template era); otherwise the adset NAME (another era) |
| `fbc_id` param | the Meta adset id (never confuse with `fbclid`, the click id) |
| `h_ad_id`, `Ad_id`, `Ad ID` variants | the Meta ad id (`Ad_id` and `h_ad_id` are duplicates, equal on 224 of 224 rows) |
| `utm_content` | the ad NAME. Ad names are NOT unique: 14 of Love School's 49 names cover 32 of its 67 ads, one name is duplicated inside a single campaign |

### Stored ids and the backfill (done 2026-08-09)

`sessions` and `payments` carry additive `campaign_id` / `adset_id` / `ad_id` columns (values mirror `ads.meta_*`). Love School's rows were backfilled once: ids extracted exactly where present, then names resolved against `ads` only when unique within the row's campaign, then the hierarchy completed from `ads`. Result: 7,730 of 8,209 sessions carry the exact ad (94 percent, versus 34 percent from raw ids alone), originals untouched byte for byte, re run changes zero rows. Rows arriving after the backfill have null ids until Trace's capture writes them, so the views must bridge with `coalesce(stored, extracted)`.

### View: `v_sessions_attributed`

Over `sessions`. Adds:

| Column | Rule |
|---|---|
| `utm_source_clean` | Strip a leading `utm_source=` from `utm_source`. Applies to 1,588 rows today |
| `ad_key` | `coalesce(ad_id, extracted ad id, campaign scoped name match)` |
| `ad_key_type` | `ad_id` when a stored or extracted identifier matched, `ad_name` when the scoped name match was used, `none` otherwise |
| `adset_key` | `coalesce(adset_id, fbc_id param, utm_term under the numeric guard)`, else the resolved ad's adset from `ads` |
| `campaign_key` | `coalesce(campaign_id, utm_id or campaign_id param)`, else the resolved ad's campaign from `ads` |
| `day_ist` | `created_at` converted to Asia/Kolkata, cast to date |

**Shared extraction rule, identical on both views.** The ad identifier is the first value passing the numeric guard among the variants `h_ad_id`, `ad_id`, `Ad_id`, `Ad ID`, `Ad+ID`, `Ad%20ID`, `Ad%2BID`, matched case insensitively (the shipped `metric_ad_id_*` functions are the one definition). The campaign identifier reads `utm_id` or `campaign_id` (the new template emits `campaign_id=`; reading only `utm_id` misses every future row). The adset identifier reads `fbc_id`, else `utm_term` under the numeric guard, because `utm_term` carries the adset id in one template era and the adset name in another, and the guard is what separates them. On sessions the source is the `landing_url` query string; on payments it is the `utm_params` keys.

**Name resolution rule.** A row with no ad identifier resolves its `utm_content` against `ads`, but only when that name maps to exactly one ad within the row's campaign. Ids always win over names. A name still ambiguous after scoping resolves nothing at ad level: the row keeps whatever adset or campaign tier did resolve and appears in the ad level Unattributed bucket. Never match names unscoped, and never break ties arbitrarily.

Use anchored regular expressions, never `LIKE '%h_ad_id%'`. In SQL `LIKE` and `ILIKE`, `_` is a single character wildcard, so `'%fbc_id%'` matches `fbclid` and silently overreports coverage. This mistake was made and caught during profiling.

### View: `v_payments_attributed`

Over `payments`, joined to `clients` for the test account signal. Adds:

| Column | Rule |
|---|---|
| `utm_source_clean` | Same prefix strip as above. 147 rows today |
| `ad_key` | `coalesce(ad_id, extracted from utm_params, campaign scoped name match)` |
| `ad_key_type` | `ad_id`, `ad_name`, or `none` |
| `adset_key` | `coalesce(adset_id, utm_params fbc_id, utm_params utm_term under the numeric guard)`, else via `ads` |
| `campaign_key` | `coalesce(campaign_id, utm_params utm_id or campaign_id)`, else via `ads` |
| `is_paid` | `status = 'paid' OR paid_at IS NOT NULL`. Four rows are paid with a null `paid_at` |
| `is_test_payment` | `amount <= 500` (Rs 5 in paise) |
| `is_test_client` | `starts_with(clients.razorpay_key_id, 'rzp_test')` — **corrected 2026-08-09**: the implementation uses `starts_with()`, not `LIKE 'rzp\_test%'`, precisely to avoid the underscore-wildcard trap this same spec warns about a few lines above (`_` is a single-character wildcard in `LIKE`/`ILIKE`) |
| `day_ist` | `COALESCE(paid_at, created_at)` converted to Asia/Kolkata, cast to date |

Only the named `utm_params` keys above are ever read by name. The key space is unbounded because campaign names leak into it as keys, so nothing may enumerate keys generically.

### View: `v_funnel_by_session`

Over `sessions LEFT JOIN events` — **corrected 2026-08-09**: not "over `events`", which was a description of a rejected implementation. The `LEFT JOIN` is deliberate, so the ~900 sessions that fired no event at all still get a row with every stage false; building this over `events` alone would silently drop them and understate top-of-funnel. One row per session with a boolean per stage, computed as **reached this stage or any later stage**, not as "fired this event". Real data has 294 sessions reaching `form_start` without `form_open` and 72 reaching `payment_complete` without `form_open`; counting raw events makes later stages exceed earlier ones and inverts the drop off chart.

### Metric definitions

Both are exposed, separately named. Neither may be labelled simply "conversion rate".

| Metric | Formula | Today |
|---|---|---|
| Conversion rate | paid payments divided by sessions | 5.68% Love School, 5.81% Occultyogis |
| Checkout completion | paid payments divided by all payment attempts | 65.3% Love School, 54.2% Occultyogis |

### Three tier attribution

The join runs in three tiers, per the cross child contract in [index.md](index.md). The `ads` table already exists and holds Love School's full hierarchy (seeded 2026-08-09 from Sharan's Ads Manager export); child 02's sync later keeps it fresh.

1. **Ad tier**: `ad_key` matches `ads.meta_ad_id` when `ad_key_type` is `ad_id`, or resolves through the campaign scoped name rule above when it is `ad_name`. A resolved ad implies its adset and campaign from `ads`. The rename caveat remains for history.
2. **Adset tier**: a row with no resolvable `ad_key` but a non null `adset_key` matches `ads.meta_adset_id` and counts in adset level rollups, marked attributed at adset level only.
3. **Campaign tier**: a row resolving neither ad nor adset but carrying a `campaign_key` matches `ads.meta_campaign_id` and counts in campaign level rollups, marked attributed at campaign level only.

### Unattributed bucket

Any breakdown grouping by `ad_key`, `adset_key` or `campaign_key` must emit an explicit `Unattributed` row for rows resolving nothing at that tier, rather than filtering them. **Corrected 2026-08-09**: this does not apply to "16 payments with no `session_id`" as a fixed unattributable set — payments resolve `ad_key`/`adset_key`/`campaign_key` from their own `utm_params`, independently of any session, so a null `session_id` does not imply unattributed. Of the 16 payments with no `session_id`, 9 resolve at the ad tier; only 7 land in `none`. The bucket applies to every row where no key resolved, full stop, regardless of `session_id`. A campaign tier row is attributed in campaign rollups and Unattributed in ad rollups; both statements are true and both must hold. The invariant is that grouped rows plus Unattributed equals the ungrouped total at every tier.

### Security

Views inherit row level security from their base tables. Create them with `security_invoker = true` so the querying user's policies apply, rather than the view owner's. Verify explicitly under both a client JWT and an admin JWT, since a view that bypasses row level security is a tenant data leak.

## Build plan

Already done (2026-08-09, migrations `ads_dimension_table`, `seed_love_school_ads`, `meta_id_columns_on_sessions_payments`, `backfill_love_school_meta_ids`): the `ads` table with row level security, Love School's 67 ad seed, the additive id columns, and the one time backfill, verified for hierarchy consistency, idempotence and untouched originals.

1. Extend the metric helpers: adset extraction (`fbc_id`, else `utm_term` under the numeric guard) and campaign extraction widened to `utm_id` or `campaign_id`, keeping `metric_campaign_id_from_url`'s signature. Reuse `metric_normalize_ad_id` and `metric_normalize_key`; never re derive the regexes.
2. Create `v_sessions_attributed` with `security_invoker`, reading `coalesce(stored id, extracted)`, satisfies **AC-1**, **AC-4**.
3. Create `v_payments_attributed`, satisfies **AC-1**, **AC-2**, **AC-4**.
4. Create `v_funnel_by_session` using reached or beyond semantics. **Corrected 2026-08-09**: this step maps to no AC directly — AC-3 is the two separately-named conversion metrics (satisfied by step 5 below), not the funnel view itself.
5. Expose both named metrics in the query layer, satisfies **AC-3**.
6. Add the adset and campaign fallback tiers and the Unattributed bucket to every grouping helper, satisfies **AC-5**, **AC-20**.
7. Verify all views under a client JWT and an admin JWT, including `ads`, satisfies **AC-6**.

## Rationale

Views rather than stored columns, because this dashboard is forbidden from writing to Trace's tables and because a view corrects all history at once with no backfill. The cost is that the repair runs on every read and that bad rows keep arriving until Trace's capture is fixed, which is tracked as a follow up.

The test threshold sits on the payment rather than the product because test products get repriced to their real value after testing. `payments.amount` is sourced server side at payment time, so those rows keep the Rs 1 value permanently, which makes the payment level rule correct retroactively and free of upkeep.

Both conversion rates are exposed because they answer different questions: sessions to paid measures the ad and the landing page, attempts to paid measures the checkout. Publishing only one would hide either ad quality or a payment gateway problem.

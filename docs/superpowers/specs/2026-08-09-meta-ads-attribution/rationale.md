# Rationale: Meta Ads Attribution and Spend Integration

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: the original topic asked for ROAS and CPA, but the database has no cost side data at all, and the numbers it does have are not yet trustworthy. A profiling pass over the live database on 2026-08-08 found three problems that would each corrupt an ad performance view built today: 15% of sessions carry a malformed `utm_source`, the funnel event sequence is not monotonic, and one of the two real clients has no ad identifiers whatsoever. Building the Meta integration first would produce precise looking ROAS numbers resting on a broken join. The right framing is to fix the meaning of the existing data first (child 01, no Meta dependency), then add spend. That reordering is why this spec is an umbrella rather than a single Meta integration spec.

The dashboard reads a live, actively growing dataset: 4 clients, 7 products, 10,395 sessions, 14,742 events and 959 payments spanning 2026-06-27 to now. Two clients carry real revenue (Love School at Rs 45,251 and Occultyogis Vastu at Rs 11,888), one is a Rs 7 test, and one is an empty shell on a test Razorpay key. Total paid revenue is Rs 57,146 across 600 paid payments from 959 attempts.

The forces shaping this decision:

**The two real clients tag their ads incompatibly.** Occultyogis carries a full Meta hierarchy in `utm_params` (`utm_id` for campaign, `fbc_id` for ad set, `h_ad_id` and `Ad_id` for ad) on roughly 90% of paid payments and 83% of sessions. Love School carries no ad identifier on any session at all, and only a differently spelled `Ad ID` key on 34% of payments. Any join design that assumes one identifier scheme silently produces nothing for one of the two paying clients.

**The `utm_params` key space is unbounded.** Campaign names appear as JSON keys, because unencoded `&` and `=` characters in ad URLs are parsed into bogus keys. Case variants of real keys coexist (`Ad ID`, `Ad_id`, `Adset content`, `Adset Content`, `Adset_Content`). Nothing may enumerate these keys generically.

**There is no cost data anywhere in the schema.** ROAS and CPA are arithmetically impossible from Trace's five tables. This is the gap the Meta integration exists to close, and it is the only reason to add an external dependency at all.

**Meta's own conversion counts will never match Trace's.** Meta attributes through its pixel across devices and view through windows; Trace attributes last touch within a single session. Showing both as "revenue" would produce two contradictory numbers on the same screen and an unwinnable support conversation.

**The team is one person and the operational budget is near zero.** The project currently runs a Next.js app on Vercel against Supabase with no background jobs, no queues and no scheduled work of any kind. Anything added here is the first thing in the system that can fail silently overnight.

**Test data is interleaved with real revenue.** Test products are created at Rs 1 and repriced to their real value after roughly five transactions, so a product level flag would misclassify the product's whole history. The signal that survives repricing lives on the payment, because `payments.amount` records what was actually charged at the time.

Not deciding means Phase 1 ships a revenue overview whose conversion rate is ambiguous, whose traffic sources are split across duplicate rows, and whose totals quietly include test transactions.

## Options considered

### Option 1: Query Meta live, store nothing

Fetch spend from Meta's API on each page load and join it in application code against payment data read from Supabase.

**Pros**:
- No new tables, no migration, no scheduled job, and nothing that can go stale.
- Numbers always match Ads Manager exactly at the moment of viewing.

**Cons**:
- Meta's Insights API is slow and rate limited per ad account per hour, so page loads become unpredictable and heavy viewing exhausts quota.
- No history beyond what the API returns, so week over week comparison depends on Meta's availability.
- The join happens in application memory, which rules out SQL aggregation and makes every drill down level a separate round trip.

### Option 2: Sync spend into dashboard owned tables, Trace payments as revenue truth (chosen)

A nightly job pulls spend and ad metadata from Meta into four new tables in Trace's existing Supabase project. Revenue always comes from `payments`. The join runs in SQL through a canonical ad key resolved in a view.

**Pros**:
- Spend and revenue live in one database, so every breakdown is a single SQL query under one row level security model.
- History accumulates independently of Meta's availability and retention.
- Idempotent upsert on `(ad_id, date_start)` makes a failed run trivially safe to re run.
- Storing the raw response as jsonb means an unanticipated metric needs no re sync.

**Cons**:
- Introduces the project's first scheduled job, its first external credential and its first thing that can break overnight without anyone noticing.
- Stored spend can disagree with Ads Manager between restatement and the next sync.
- Four new tables to keep row level security correct on.

### Option 3: Sync into a separate Supabase project owned by the dashboard

Same sync, but the ad tables live in their own Supabase project, cleanly separated from Trace's data.

**Pros**:
- Unambiguous ownership boundary enforced by infrastructure rather than convention.
- No possibility of this dashboard's migrations affecting Trace's production database.

**Cons**:
- Ad spend and payments end up in different databases, so the central join moves into application code and SQL aggregation is lost, which is the main benefit of Option 2.
- Two row level security models and two sets of credentials to keep synchronized.
- Cost and operational overhead of a second project for four clients.

### Option 4: Have Trace's backend own the sync, dashboard reads only

Trace's own repository gains the Meta integration and writes the tables; the dashboard reads them.

**Pros**:
- Preserves the current strict split where only Trace writes and the dashboard only reads.
- Ad data becomes available to Trace's own features, not just this dashboard.

**Cons**:
- Shipping this requires changes in a repository the dashboard does not control, so its schedule is not yours.
- The dashboard is where the requirement lives, so ownership and motivation sit in different places.
- Slower iteration on exactly the part most likely to need iteration.

## Rationale

Option 2 wins mainly on the join. The entire value of this feature is comparing spend to revenue at ad granularity, and that comparison is a `GROUP BY` if both sides share a database and an application level loop if they do not. Option 3's cleaner ownership boundary is real, but it pays for that boundary with the exact capability the feature exists to provide. Option 1 fails on Meta's per account hourly rate limits, which turn a viewing pattern (several people opening a drill down repeatedly) into an outage. Option 4 is defensible and would be right if Trace itself needed ad data, but nothing indicates it does, and putting the work in another repository slows the part of the system most likely to change.

The revenue truth decision follows from the support burden rather than from technical merit. Both attribution models are internally coherent; they simply measure different things. Since the business is paid on Trace's payment records, those are the numbers with consequences, and showing a second contradictory revenue figure buys nothing but argument.

Partner access with a single System User token replaced the initially chosen per client OAuth flow once the actual permission requirements were checked. The decisive facts were that `ads_read` with the Analyst role is sufficient for reporting, and that Advanced access, required to reach ad accounts owned by other businesses, must be maintained with at least 500 Marketing API calls every 15 days. A four client nightly sync plausibly falls below that floor, which would mean losing access for being too small. Partner sharing sidesteps both the App Review lead time and the maintenance floor, while asking clients for strictly less than OAuth would.

Writing a thin Meta client rather than using the official SDK runs against Meta's own recommendation, and that is deliberate. Meta built the Business SDK to cover many APIs at once; this feature needs four read only endpoints from one API. The stronger signal is what the data pipeline companies do: Airbyte and Fivetran both call the Graph API directly, and both deliberately pin older versions (v24.0 and v23.0 respectively, against a current v25.0). Controlling exactly when you move versions is the requirement here, and an SDK that tracks Meta's releases works against it.

The test data decision changed during the conversation and is worth recording. A product level flag was the obvious answer until it emerged that test products are repriced to their real value after testing, which makes any product level flag retroactively wrong about that product's early history. Because `payments.amount` is sourced server side from `products.amount` at payment time, the historical rows keep the Rs 1 value permanently. That makes a payment level threshold both simpler and more correct, with no migration and no ongoing upkeep. The engineer set the threshold at Rs 5, comfortably below the Rs 99 real products.

The engineer chose to badge test rows rather than filter them out, against the recommendation to filter. That is a reasonable call given the volume is roughly five transactions per launch, and it has the merit that nothing is ever hidden. The tradeoff consciously accepted is that every headline revenue number carries a small amount of test revenue.

A cross check by an independent model after drafting surfaced ten gaps, all resolved by the engineer before acceptance. The three that changed the design: write access to the new tables needs deliberate `WITH CHECK` policies under the admin identity, because a `USING` only policy denies inserts and the service role key is forbidden in handlers; the sync became a two step submit then poll design, because a Meta asynchronous report can outlive a single function invocation; and the join gained a campaign fallback tier, because Love School's sessions carry campaign identifiers on 94% of rows and ad identifiers on none, so a single tier join would have discarded their strongest real signal into the Unattributed bucket. The verified fact that Trace captures attribution from the landing page URL in the browser, not from Razorpay notes, means Love School's missing ad identifiers are fixable forward by setting Meta's dynamic URL parameters on their ads, with no code change.

## Evidence: live database profile, 2026-08-08

Read through the admin dev identity under row level security, and separately verified through the Supabase MCP connection. The `*_secret_enc` columns were never queried.

**Volumes**: clients 4, products 7, sessions 10,395, events 14,742, payments 959. Row counts grew during profiling, confirming live traffic.

**Revenue by client**:

| Client | Sessions | Paid | Attempts | Session to paid | Revenue |
|---|---|---|---|---|---|
| Love School | 8,180 | 465 | 712 | 5.68% | Rs 45,251 |
| Occultyogis Vastu | 2,204 | 128 | 236 | 5.81% | Rs 11,888 |
| The Batra Numerology | 11 | 7 | 11 | 63.6% | Rs 7 |
| MNW | 0 | 0 | 0 | n/a | Rs 0 |

Payment status overall: 600 paid, 277 created, 82 failed.

**Ad identifier coverage on paid payments**:

| Client | Paid | With ad identifier | With campaign id | With ad name |
|---|---|---|---|---|
| Love School | 465 | 158 (34%) | 437 (94%) | 449 (97%) |
| Occultyogis Vastu | 128 | 115 (90%) | 115 (90%) | 115 (90%) |

**Ad identifier coverage on sessions** (the denominator, required for any conversion rate):

| Client | Sessions | With ad identifier | With campaign id | With ad name | Distinct ads |
|---|---|---|---|---|---|
| Love School | 8,181 | **0** | 7,719 (94%) | 7,860 (96%) | 0 |
| Occultyogis Vastu | 2,211 | 1,837 (83%) | 1,788 (81%) | 2,000 (90%) | 154 |

The zero is the single most consequential number in this profile. It is why the canonical ad key must fall back to `utm_content`, and why Love School's ad level figures carry a weak match marker.

**Data quality findings**:

- 1,588 sessions (15%) and 147 payments carry a `utm_source` of `utm_source=METAxAM`, the parameter key leaked into its own value, splitting one traffic source across two rows.
- The funnel is not monotonic: 294 sessions fired `form_start` with no `form_open`, 136 fired `form_submit` with no `form_start`, 72 reached `payment_complete` with no `form_open`, and 891 sessions have no events at all. Funnel stages must be computed as "reached stage N or beyond".
- `tti_ms` is populated on 0 of 10,395 sessions. `network_type` 46.6% and `device_ram_gb` 48.1%.
- 4 payments have `status = 'paid'` with a null `paid_at`, so `status = 'paid' OR paid_at IS NOT NULL` is the safe predicate.
- 146 paid payments have `raw_payload = '{}'`, which matches the documented webhook not registered case in `.claude/rules/invariants.md` and is expected rather than broken.
- 16 payments have no `session_id` and are therefore permanently unattributable.
- `minutes_to_convert` has a median of 0 and a maximum of 25, because it only measures within session time. It cannot support a time to convert view.
- `utm_medium` carries placement for one client (`Instagram_Reels`) and campaign names for another (`Love +Reality Show - 12/12/2025`), so its meaning is not consistent across tenants.

**Correction made during profiling**: an initial coverage count used `ILIKE '%fbc_id%'`, where `_` is a single character wildcard in SQL, so it matched `fbclid` and reported false coverage for Love School. Re measuring with anchored regular expressions produced the zero above. Any future query touching these column names must escape the underscore.

## References

**Project sources**:
- `.claude/rules/invariants.md`: the never write to Trace's tables rule, and the documented `raw_payload = '{}'` case, both of which shape the read layer view approach.
- `.claude/rules/auth-security.md`: the existing row level security pattern (`client_id` claim OR `is_admin`) reused verbatim for the four new tables.
- `.claude/rules/data-model.md`: the note that `fbc_id` and `h_ad_id` are ad set and ad identifiers rather than click identifiers, which fixes the join hierarchy.
- `supabase/migrations/20260707000000_dashboard_rls_policies.sql`: the policy shape the new tables copy.
- `docs/superpowers/specs/2026-08-08-visual-design-system.md`: the bento tiles, tokens and StatusBadge the Ads section builds on, including the rule that colour carries semantic status only.
- Live database profile, 2026-08-08, recorded above.

**Practices and standards**:
- Least privilege: `ads_read` with the Analyst role rather than `ads_management` with admin.
- Idempotent upsert on a natural key for any job that may re run.
- Store raw counters and derive rates at read time, rather than storing computed values that go stale.
- Never store secrets in application accessible tables or in the repository.
- Pin external API versions deliberately rather than tracking latest.
- Exponential backoff against a rate limited third party.

**Links** (verified during this conversation):
- Marketing API Authorization, `ads_read` versus `ads_management` and the App Review boundary: https://developers.facebook.com/docs/marketing-api/overview/authorization/
- Ad Creative Previews, the 24 hour iframe expiry: https://developers.facebook.com/docs/marketing-api/reference/ad-creative/previews/
- Ads Insights API: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights
- Insights limits and best practices, asynchronous jobs: https://developers.facebook.com/docs/marketing-api/insights/best-practices/
- Marketing API rate limiting: https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
- Meta Business SDK, the official recommendation: https://developers.facebook.com/docs/business-sdk/
- facebook-nodejs-business-sdk: https://github.com/facebook/facebook-nodejs-business-sdk
- Airbyte Facebook Marketing connector, direct Graph API calls and version pinning: https://docs.airbyte.com/integrations/sources/facebook-marketing
- Fivetran Facebook Ads connector: https://fivetran.com/docs/connectors/applications/facebook-ads
- Meta ad account roles and permissions: https://www.adamigo.ai/blog/meta-ad-account-roles-and-permissions-explained
- Marketing API Q2 2026 update, version sunsets: https://www.kitchn.io/blog/meta-marketing-api-q2-2026-update

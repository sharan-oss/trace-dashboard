-- v_customers_attributed — the customer → acquiring-ad join, defined ONCE.
--
-- This is the spine of the Customers section. Every consumer (the KPI RPC, the
-- acquisition table, the top-customers strip, and the People tab when it ships)
-- composes this view rather than re-deriving the join, so they cannot drift
-- apart — the same discipline v_ad_name_resolution established for ad names.
--
-- The chain it encodes is the entire attribution product:
--   ad → L1 payment → customer (identity spine) → later L2 purchases
-- customers.l1_payment_id names the payment that acquired the person, and
-- v_payments_attributed already resolves that payment to an ad through three
-- tiers. So a Rs 40,000 upsell paid days later on a bare Razorpay link is
-- credited to the ad that bought the customer, which nothing else in the
-- client's stack can do.
--
-- security_invoker = true is NOT optional. Without it this view executes with
-- its owner's privileges and bypasses RLS on customers, payments and
-- external_payments at once — precisely the failure that leaked 652 rows across
-- two tenants on 2026-08-09 (see 20260810090000). anon holds the publishable
-- key, which ships to the browser; it is revoked below and must stay revoked.
--
-- LEFT JOINs throughout: a customer whose acquiring payment is missing, or
-- resolves no ad, still appears with null keys and falls into the Unattributed
-- bucket. Customers are never silently dropped from a total.

create or replace view public.v_customers_attributed
with (security_invoker = true) as
with second_purchase as (
  -- The second purchase in time, per customer. row_id breaks ties so the pick
  -- is deterministic when two purchases share a timestamp.
  select customer_id, paid_at
  from (
    select
      customer_id,
      paid_at,
      row_number() over (partition by customer_id order by paid_at, row_id) as rn
    from public.customer_payments_unified
  ) ranked
  where rn = 2
)
select
  cs.customer_id,
  cs.client_id,
  cs.name,
  cs.email_norm,
  cs.phone_norm,
  cs.l1_payment_id,

  -- Acquisition timing. first_paid_at is the cohort key: a customer belongs to
  -- the range in which they FIRST paid, never a later one. Verified 2026-08-16
  -- to agree byte-for-byte with min(paid_at) over their purchases on all 1,148
  -- live rows, and tests/customers-rpcs.test.ts keeps asserting it.
  cs.first_paid_at,
  cs.last_paid_at,
  (cs.first_paid_at at time zone 'Asia/Kolkata')::date as acquired_day_ist,

  -- Value. lifetime_amount is every purchase they have ever made, from both
  -- worlds — lifetime-to-date, deliberately not a bounded window (design doc
  -- 2026-08-16, decision 3).
  cs.purchase_count,
  cs.lifetime_amount as lifetime_paise,
  (cs.purchase_count >= 2) as is_repeat,

  sp.paid_at as second_paid_at,
  case
    when sp.paid_at is not null and cs.first_paid_at is not null
    then extract(epoch from (sp.paid_at - cs.first_paid_at)) / 86400.0
  end as days_to_second,

  -- The acquiring ad, straight off the already-attributed L1 payment.
  pa.ad_key,
  pa.ad_name,
  pa.adset_key,
  pa.adset_name,
  pa.campaign_key,
  pa.campaign_name,
  pa.attribution_tier,

  -- Test marking rides along so the UI can badge rather than silently filter,
  -- matching how the Ads section treats test rows.
  (coalesce(pa.is_test_payment, false) or coalesce(pa.is_test_client, false)) as has_test
from public.customer_spend cs
left join second_purchase sp on sp.customer_id = cs.customer_id
left join public.v_payments_attributed pa on pa.id = cs.l1_payment_id;

revoke select on public.v_customers_attributed from public;
revoke select on public.v_customers_attributed from anon;
grant  select on public.v_customers_attributed to authenticated;

-- ---------------------------------------------------------------------------
-- overview_day_payments — the Overview graph's day drill-down (2026-09-06)
--
-- WHY THIS EXISTS. The revenue graph buckets every payment on the day it was
-- PAID. Customers -> People filters by ACQUISITION COHORT (`acquired_day_ist`,
-- see src/lib/queries/customers.ts). Both are correct and both must stay
-- correct — cohort semantics are what make LTV:CAC honest (design doc
-- 2026-08-16, decision 3). But they disagree by construction: on 2026-09-06 the
-- graph showed six upsells while People showed four, because two of the six
-- buyers were first acquired on 16 and 30 Aug, outside the 7-day cohort window.
--
-- Neither number was wrong; there was simply nothing that answered "who bought
-- on this day?". That is this function. It is scoped by PAYMENT DAY, so
-- clicking a point and reading the list can never contradict the point.
--
-- THE CONTRACT. This function takes the SAME window arguments as
-- overview_revenue_daily and carries the SAME predicate text, adding only
-- `= p_day`. Its rows are therefore a strict narrowing of that function's input
-- set, so sum(rows) = that day's graph point BY CONSTRUCTION — in default and
-- split mode, on every day, including days outside either window where both
-- sides are empty. tests/overview-day-drilldown.test.ts asserts it anyway.
--
-- IF YOU EDIT A PREDICATE BELOW, edit the matching one in
-- 20260817090000_custom_windows_and_cohort_l2.sql in the same commit. There is
-- no way to share the text between a scalar-returning and a row-returning
-- function without inventing a third object, and a third object is a third
-- thing to drift.
--
-- The L2 cohort test is the exists() form from overview_revenue_daily, NOT the
-- `va.id is not null` join form from overview_top_ads. Those two are
-- equivalent, but the graph is drawn by overview_revenue_daily, so this matches
-- that one character for character.
--
-- The cu/va LEFT JOINs are for DISPLAY ONLY (both on primary keys, so no
-- fan-out) and deliberately do not participate in either predicate:
--   * L1 must NOT inner-join customers — verified live, payments with a null
--     customer_id do count in the graph and must appear here too.
--   * L2 needs cu.name because the synced external_payments rows carry an
--     EMPTY customer_name; the acquiring ad comes from the customer's L1
--     payment, which is the same credit overview_top_ads gives it.
--
-- L1 membership is v.is_paid — the view's own
-- `status = 'paid' or paid_at is not null`. Never `payments.status = 'paid'`,
-- which is what customer_payments_unified uses and which drops the documented
-- rows that are paid with a null paid_at.
--
-- acquired_day_ist is `customers.first_paid_at` in IST, the SAME expression
-- v_customers_attributed uses — so it is literally the value People filters on.
-- It is not va.day_ist (what split mode's cohort predicate tests); those differ
-- when a customer's earliest purchase was external. Showing the People value is
-- deliberate: the column exists to explain the People page, not the predicate.
-- ---------------------------------------------------------------------------

create or replace function public.overview_day_payments(
  p_client_id uuid,
  p_day date,
  p_days int default null,
  p_from date default null,
  p_to date default null,
  p_l2_from date default null,
  p_l2_to date default null,
  p_limit int default 500
)
returns table (
  arm text,
  row_id uuid,
  paid_at timestamptz,
  amount bigint,
  customer_id uuid,
  customer_name text,
  customer_email text,
  product_name text,
  source text,
  ad_key text,
  ad_name text,
  campaign_name text,
  acquired_day_ist date,
  has_test boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with win as (
    select
      coalesce(p_from, case
        when p_days is null then null::date
        else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
      end) as from_day,
      p_to as to_day,
      (p_l2_from is not null and p_l2_to is not null) as l2_split
  ),
  l1 as (
    select
      'l1'::text                                           as arm,
      v.id                                                 as row_id,
      coalesce(v.paid_at, v.created_at)                    as paid_at,
      v.amount::bigint                                     as amount,
      v.customer_id                                        as customer_id,
      nullif(v.customer_name, '')                          as customer_name,
      nullif(v.customer_email, '')                         as customer_email,
      pr.name                                              as product_name,
      v.gateway                                            as source,
      v.ad_key                                             as ad_key,
      v.ad_name                                            as ad_name,
      v.campaign_name                                      as campaign_name,
      (cu.first_paid_at at time zone 'Asia/Kolkata')::date as acquired_day_ist,
      (v.is_test_payment or v.is_test_client)              as has_test
    from v_payments_attributed v
    cross join win w
    left join products pr on pr.id = v.product_id
    left join customers cu on cu.id = v.customer_id
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
      and v.day_ist = p_day
  ),
  l2 as (
    select
      'l2'::text                                           as arm,
      ep.id                                                as row_id,
      coalesce(ep.paid_at, ep.created_at)                  as paid_at,
      ep.amount::bigint                                    as amount,
      ep.customer_id                                       as customer_id,
      coalesce(nullif(ep.customer_name, ''), cu.name)      as customer_name,
      coalesce(nullif(ep.email_norm, ''),
               nullif(ep.customer_email, ''),
               cu.email_norm)                              as customer_email,
      ep.product_name                                      as product_name,
      ep.source                                            as source,
      va.ad_key                                            as ad_key,
      va.ad_name                                           as ad_name,
      va.campaign_name                                     as campaign_name,
      (cu.first_paid_at at time zone 'Asia/Kolkata')::date as acquired_day_ist,
      (coalesce(va.is_test_payment, false)
        or coalesce(va.is_test_client, false))             as has_test
    from external_payments ep
    cross join win w
    left join customers cu on cu.id = ep.customer_id
    left join v_payments_attributed va on va.id = cu.l1_payment_id
    where ep.client_id = p_client_id
      and ep.status = 'captured'
      and not exists (
        select 1 from payments p
        where p.order_id = ep.external_order_id
          and p.client_id = ep.client_id
      )
      and (
        (not w.l2_split
          and (w.from_day is null
               or (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date >= w.from_day)
          and (w.to_day is null
               or (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date <= w.to_day))
        or
        (w.l2_split
          and (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date
              between p_l2_from and p_l2_to
          and exists (
            select 1
            from customers cu2
            join v_payments_attributed va2 on va2.id = cu2.l1_payment_id
            where cu2.id = ep.customer_id
              and (w.from_day is null or va2.day_ist >= w.from_day)
              and (w.to_day is null or va2.day_ist <= w.to_day)
          ))
      )
      and (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date = p_day
  ),
  merged as (
    select * from l1
    union all
    select * from l2
  )
  -- Every reference qualified: arm/row_id/amount/source are also OUT parameter
  -- names, and an unqualified reference to one is ambiguous inside a SQL
  -- function. (overview_revenue_daily sidesteps the same hazard with `order by 1`.)
  select
    m.arm, m.row_id, m.paid_at, m.amount, m.customer_id,
    m.customer_name, m.customer_email, m.product_name, m.source,
    m.ad_key, m.ad_name, m.campaign_name, m.acquired_day_ist, m.has_test
  from merged m
  order by m.arm, m.amount desc, m.row_id
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.overview_day_payments(uuid, date, int, date, date, date, date, int) from public;
revoke execute on function public.overview_day_payments(uuid, date, int, date, date, date, date, int) from anon;
grant execute on function public.overview_day_payments(uuid, date, int, date, date, date, date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- payment_method on the two L2 row-level reads (2026-09-15)
--
-- Hand-recorded upsells (external_payments.source = 'manual') carry HOW the
-- money moved only in raw_payload->>'method' ('gpay' for all eight rows so
-- far). Nothing read it, so the UI could only say "Recorded by hand" — and the
-- customer sheet, which never looked at `source` at all, called the same rows
-- "Payment link". Sharan asked for the method to be named directly.
--
-- Additive only: one nullable text column, `payment_method`, appended to
--   * customer_payments_unified  (view — appending a column is allowed by
--     CREATE OR REPLACE; column order of the existing ones is untouched, so
--     v_customers_attributed and customer_spend, which select by name, are
--     unaffected)
--   * overview_day_payments      (function — a RETURNS TABLE change needs a
--     DROP first; the body below is the 20260906090000 text with one column
--     added per arm and nothing else changed. Its predicate contract with
--     overview_revenue_daily still holds; tests/overview-day-drilldown.test.ts
--     re-asserts it.)
--
-- Trace-checkout rows get null: payments.raw_payload nests the method several
-- levels deep in a gateway-specific shape and the UI does not need it there —
-- "Trace checkout" already says everything about provenance.
-- ---------------------------------------------------------------------------

create or replace view public.customer_payments_unified as
  select
    p.customer_id,
    p.client_id,
    'trace'::text as origin,
    p.gateway as source,
    p.id as row_id,
    p.amount,
    p.currency,
    coalesce(p.paid_at, p.created_at) as paid_at,
    pr.name as product_name,
    null::text as payment_method
  from public.payments p
  left join public.products pr on pr.id = p.product_id
  where p.status = 'paid'::text
    and p.customer_id is not null
  union all
  select
    ep.customer_id,
    ep.client_id,
    'external'::text as origin,
    ep.source,
    ep.id as row_id,
    ep.amount,
    ep.currency,
    coalesce(ep.paid_at, ep.created_at) as paid_at,
    ep.product_name,
    nullif(ep.raw_payload ->> 'method', '') as payment_method
  from public.external_payments ep
  where ep.status = 'captured'::text
    and ep.customer_id is not null;

-- Reloptions and grants survive CREATE OR REPLACE, but restate the ones that
-- matter so this file is a complete description of the object.
alter view public.customer_payments_unified set (security_invoker = on);
revoke select on public.customer_payments_unified from anon;
grant  select on public.customer_payments_unified to authenticated;

drop function if exists public.overview_day_payments(uuid, date, int, date, date, date, date, int);

create function public.overview_day_payments(
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
  has_test boolean,
  payment_method text
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
      (v.is_test_payment or v.is_test_client)              as has_test,
      null::text                                           as payment_method
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
        or coalesce(va.is_test_client, false))             as has_test,
      nullif(ep.raw_payload ->> 'method', '')              as payment_method
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
    m.ad_key, m.ad_name, m.campaign_name, m.acquired_day_ist, m.has_test,
    m.payment_method
  from merged m
  order by m.arm, m.amount desc, m.row_id
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.overview_day_payments(uuid, date, int, date, date, date, date, int) from public;
revoke execute on function public.overview_day_payments(uuid, date, int, date, date, date, date, int) from anon;
grant execute on function public.overview_day_payments(uuid, date, int, date, date, date, date, int) to authenticated;

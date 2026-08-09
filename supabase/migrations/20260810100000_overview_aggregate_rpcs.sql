-- Overview aggregate RPCs — the dashboard's Phase 1 Overview screen reads
-- exactly three server-side aggregates so no raw rows are ever paged into JS.
-- All three are `security invoker`: RLS on the underlying views/tables is the
-- tenant guarantee; the p_client_id filter is defense-in-depth on top, never
-- the only defense.
--
-- Date semantics: p_days null = all time; otherwise the window is the last
-- p_days IST calendar days inclusive of today, computed as
--   (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
-- compared against day_ist (L1/sessions — already the views' IST day) and
-- against coalesce(paid_at, created_at) converted to IST for external
-- payments, mirroring customer_payments_unified's date rule.
--
-- L2 side facts, verified live 2026-08-10 before writing this file:
--   * external_payments rows counted are status = 'captured' — the same
--     literal customer_payments_unified filters on (that view is not in
--     version control; definition read via pg_get_viewdef).
--   * Probed all 12 external_payments rows: ZERO external_order_id values
--     match any payments.order_id, including Occultyogis' two ₹99 rows
--     (which carry distinct product names, "Energy Vastu - BRE"/"- GCFB",
--     so they may be genuine L2 rather than re-imported L1s). The
--     not-exists dedupe guard below is therefore a no-op today, and is kept
--     deliberately: it excludes only provable L1 re-imports, so it stays
--     correct as the Razorpay backfill arrives without ever double-counting
--     revenue already in payments.
--
-- overview_top_ads groups by ad_key INCLUDING the null group (the
-- Unattributed bucket — selection of top-5 happens app-side via the
-- existing groupWithUnattributed helper so the bucket is never dropped).
-- L1 and L2 are aggregated in separate CTEs and joined afterwards; joining
-- before summing would fan out L1 amounts across L2 rows.
-- L2 revenue is credited to the ad behind the customer's FIRST L1 purchase
-- (customers.l1_payment_id -> v_payments_attributed.ad_key) — the agreed
-- acquisition-credit rule. Attribution is only ever READ off the views,
-- never re-derived here.

create or replace function public.overview_kpis(
  p_client_id uuid,
  p_days int default null
)
returns table (
  l1_revenue_paise bigint,
  l1_paid_count bigint,
  l2_revenue_paise bigint,
  l2_count bigint,
  sessions_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  l1 as (
    select coalesce(sum(v.amount), 0)::bigint as revenue,
           count(*)::bigint as cnt
    from v_payments_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
  ),
  l2 as (
    select coalesce(sum(ep.amount), 0)::bigint as revenue,
           count(*)::bigint as cnt
    from external_payments ep
    cross join cutoff c
    where ep.client_id = p_client_id
      and ep.status = 'captured'
      and (c.from_day is null
           or (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date >= c.from_day)
      and not exists (
        select 1 from payments p
        where p.order_id = ep.external_order_id
          and p.client_id = ep.client_id
      )
  ),
  s as (
    select count(*)::bigint as cnt
    from v_sessions_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and (c.from_day is null or v.day_ist >= c.from_day)
  )
  select l1.revenue, l1.cnt, l2.revenue, l2.cnt, s.cnt
  from l1, l2, s;
$$;

create or replace function public.overview_revenue_daily(
  p_client_id uuid,
  p_days int default null
)
returns table (
  day date,
  l1_revenue_paise bigint,
  l2_revenue_paise bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  l1 as (
    select v.day_ist as d, sum(v.amount)::bigint as revenue
    from v_payments_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
    group by v.day_ist
  ),
  l2 as (
    select (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date as d,
           sum(ep.amount)::bigint as revenue
    from external_payments ep
    cross join cutoff c
    where ep.client_id = p_client_id
      and ep.status = 'captured'
      and (c.from_day is null
           or (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date >= c.from_day)
      and not exists (
        select 1 from payments p
        where p.order_id = ep.external_order_id
          and p.client_id = ep.client_id
      )
    group by 1
  )
  select coalesce(l1.d, l2.d) as day,
         coalesce(l1.revenue, 0)::bigint as l1_revenue_paise,
         coalesce(l2.revenue, 0)::bigint as l2_revenue_paise
  from l1
  full outer join l2 on l1.d = l2.d
  order by 1;
$$;

create or replace function public.overview_top_ads(
  p_client_id uuid,
  p_days int default null
)
returns table (
  ad_key text,
  ad_name text,
  campaign_name text,
  l1_revenue_paise bigint,
  l2_revenue_paise bigint,
  customers_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  l1 as (
    select v.ad_key as k,
           max(v.ad_name) as ad_name,
           max(v.campaign_name) as campaign_name,
           sum(v.amount)::bigint as revenue,
           count(distinct v.customer_id)::bigint as customers
    from v_payments_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
    group by v.ad_key
  ),
  -- Left joins so an external payment with no linked customer (or a customer
  -- whose L1 payment resolves no ad) still lands in the null-key bucket
  -- instead of vanishing — Σ over all groups must equal overview_kpis' L2.
  l2 as (
    select va.ad_key as k, sum(ep.amount)::bigint as revenue
    from external_payments ep
    left join customers cu on cu.id = ep.customer_id
    left join v_payments_attributed va on va.id = cu.l1_payment_id
    cross join cutoff c
    where ep.client_id = p_client_id
      and ep.status = 'captured'
      and (c.from_day is null
           or (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date >= c.from_day)
      and not exists (
        select 1 from payments p
        where p.order_id = ep.external_order_id
          and p.client_id = ep.client_id
      )
    group by va.ad_key
  )
  -- Postgres cannot FULL JOIN on `is not distinct from` (not hash-joinable);
  -- coalescing both sides to a sentinel makes the null groups pair up under
  -- plain equality. The sentinel never collides with real ad keys, which are
  -- Meta numeric ids.
  select coalesce(l1.k, l2.k) as ad_key,
         l1.ad_name,
         l1.campaign_name,
         coalesce(l1.revenue, 0)::bigint as l1_revenue_paise,
         coalesce(l2.revenue, 0)::bigint as l2_revenue_paise,
         coalesce(l1.customers, 0)::bigint as customers_count
  from l1
  full outer join l2
    on coalesce(l1.k, '__unattributed__') = coalesce(l2.k, '__unattributed__');
$$;

-- Revoke both explicitly: Supabase's default privileges grant execute to anon
-- at creation time independently of the PUBLIC pseudo-role (see migration
-- 20260809140600). anon would only get zero rows through RLS anyway, but the
-- surface stays closed on principle.
revoke execute on function public.overview_kpis(uuid, int) from public;
revoke execute on function public.overview_kpis(uuid, int) from anon;
grant execute on function public.overview_kpis(uuid, int) to authenticated;

revoke execute on function public.overview_revenue_daily(uuid, int) from public;
revoke execute on function public.overview_revenue_daily(uuid, int) from anon;
grant execute on function public.overview_revenue_daily(uuid, int) to authenticated;

revoke execute on function public.overview_top_ads(uuid, int) from public;
revoke execute on function public.overview_top_ads(uuid, int) from anon;
grant execute on function public.overview_top_ads(uuid, int) to authenticated;

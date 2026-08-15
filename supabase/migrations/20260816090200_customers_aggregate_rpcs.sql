-- Customers section aggregate RPCs (Value tab).
--
-- Same doctrine as overview_* and ads_*: security invoker (RLS is the
-- guarantee, p_client_id is defense-in-depth), IST day windows with p_days null
-- = all time, execute revoked from anon, no raw rows ever paged into JS to be
-- summed. Every one of these composes v_customers_attributed rather than
-- re-deriving the customer -> acquiring-ad join.
--
-- THE RANGE MEANS ACQUISITION COHORT (design doc 2026-08-16, decision 2): a
-- customer belongs to the range in which they FIRST paid, and their value is
-- counted in full — including upsells that land after the range ends. That is
-- the only arrangement in which LTV:CAC is arithmetically honest, because CAC
-- and LTV then describe the same people. An "everyone who paid in range" view
-- would compare spend that acquired June's customers against August's upsell
-- revenue.
--
-- These return counts and paise only. Every ratio (repeat rate, CAC, LTV:CAC,
-- AOV) is computed in TypeScript through the existing ratio() helper, which
-- returns null rather than NaN or Infinity when a denominator is zero.

-- ---------------------------------------------------------------------------
-- customers_kpis — the tile row.
--
-- Spend is summed exactly as ads_summary sums it (through the ads join), so the
-- CAC denominator on this page and the Meta spend tile on /ads can never
-- disagree.
--
-- The L2 coverage columns are deliberately NOT range-filtered: they describe how
-- much upsell history has ever been imported, which is a property of the data,
-- not of the range. They feed the honesty line under LTV:CAC.
-- ---------------------------------------------------------------------------
create or replace function public.customers_kpis(
  p_client_id uuid,
  p_days int default null
)
returns table (
  cohort_customers bigint,
  repeat_customers bigint,
  cohort_lifetime_paise bigint,
  spend_paise bigint,
  median_days_to_second numeric,
  immature_customers bigint,
  l2_rows bigint,
  l2_first_day date,
  l2_last_day date
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
  cohort as (
    select v.*
    from v_customers_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and (c.from_day is null or v.acquired_day_ist >= c.from_day)
  ),
  spend as (
    select coalesce(sum(i.spend_minor), 0)::bigint as total
    from ad_insights_daily i
    join ads a on a.id = i.ad_id
    cross join cutoff c
    where i.client_id = p_client_id
      and (c.from_day is null or i.date_start >= c.from_day)
  ),
  coverage as (
    select
      count(*)::bigint as rows_n,
      min((coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date) as d0,
      max((coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date) as d1
    from external_payments ep
    where ep.client_id = p_client_id
      and ep.status = 'captured'
  )
  select
    (select count(*) from cohort)::bigint,
    (select count(*) from cohort where is_repeat)::bigint,
    (select coalesce(sum(lifetime_paise), 0) from cohort)::bigint,
    (select total from spend),
    (select percentile_cont(0.5) within group (order by days_to_second::double precision)
       from cohort where days_to_second is not null)::numeric,
    -- Acquired inside the last 7 days: their upsell window (median ~3 days) has
    -- not closed, so their LTV is not yet meaningful. Counted, never hidden.
    (select count(*) from cohort
       where acquired_day_ist > (now() at time zone 'Asia/Kolkata')::date - 7)::bigint,
    (select rows_n from coverage),
    (select d0 from coverage),
    (select d1 from coverage);
$$;

-- ---------------------------------------------------------------------------
-- customers_by_ad — the acquisition quality table.
--
-- Cohort counts and ad spend are aggregated separately then combined by
-- UNION ALL + re-GROUP, the same pattern ads_breakdown uses: GROUP BY treats
-- nulls as equal, so the Unattributed bucket lines up without sentinel
-- gymnastics and nothing fans out.
--
-- Two row kinds that must both survive, because each is a real signal:
--   * customers with no resolvable ad  -> the null-key Unattributed row
--   * ads with spend but no customers  -> spent money, acquired nobody
-- A seed row guarantees the Unattributed bucket is emitted even when it is
-- empty, so the table always reconciles visibly rather than by omission.
-- ---------------------------------------------------------------------------
create or replace function public.customers_by_ad(
  p_client_id uuid,
  p_days int default null
)
returns table (
  ad_key text,
  ad_name text,
  campaign_name text,
  customers bigint,
  repeat_customers bigint,
  cohort_lifetime_paise bigint,
  spend_paise bigint
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
  cohort as (
    select v.*
    from v_customers_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and (c.from_day is null or v.acquired_day_ist >= c.from_day)
  ),
  by_ad as (
    select
      ad_key as ak,
      max(ad_name) as a_name,
      max(campaign_name) as c_name,
      count(*)::bigint as cust,
      count(*) filter (where is_repeat)::bigint as rep,
      coalesce(sum(lifetime_paise), 0)::bigint as ltv,
      0::bigint as sp
    from cohort
    group by ad_key
  ),
  spend_by_ad as (
    select
      a.meta_ad_id as ak,
      max(a.ad_name) as a_name,
      max(a.campaign_name) as c_name,
      0::bigint as cust,
      0::bigint as rep,
      0::bigint as ltv,
      sum(i.spend_minor)::bigint as sp
    from ad_insights_daily i
    join ads a on a.id = i.ad_id
    cross join cutoff c
    where i.client_id = p_client_id
      and (c.from_day is null or i.date_start >= c.from_day)
    group by a.meta_ad_id
  ),
  seed as (
    select
      null::text as ak, null::text as a_name, null::text as c_name,
      0::bigint as cust, 0::bigint as rep, 0::bigint as ltv, 0::bigint as sp
  ),
  united as (
    select * from by_ad
    union all select * from spend_by_ad
    union all select * from seed
  )
  select
    u.ak as ad_key,
    max(u.a_name) as ad_name,
    max(u.c_name) as campaign_name,
    sum(u.cust)::bigint as customers,
    sum(u.rep)::bigint as repeat_customers,
    sum(u.ltv)::bigint as cohort_lifetime_paise,
    sum(u.sp)::bigint as spend_paise
  from united u
  group by u.ak
  order by cohort_lifetime_paise desc, spend_paise desc;
$$;

-- ---------------------------------------------------------------------------
-- customers_ladder — how far down the purchase sequence the cohort gets.
--
-- Ordinal 3 means "third purchase or beyond", so the three rows partition every
-- purchase the cohort has ever made. Revenue therefore sums across ordinals to
-- exactly customers_kpis.cohort_lifetime_paise — an invariant the test suite
-- asserts, and the reason the value-concentration bar can be derived from this
-- one source (ordinal 1 versus the rest) instead of being computed twice.
--
-- customers and purchases differ at ordinal 3+: one customer with five
-- purchases contributes 1 customer and 3 purchases.
-- ---------------------------------------------------------------------------
create or replace function public.customers_ladder(
  p_client_id uuid,
  p_days int default null
)
returns table (
  ordinal int,
  customers bigint,
  purchases bigint,
  revenue_paise bigint
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
  cohort as (
    select v.customer_id
    from v_customers_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and (c.from_day is null or v.acquired_day_ist >= c.from_day)
  ),
  ranked as (
    select
      u.customer_id,
      u.amount,
      row_number() over (partition by u.customer_id order by u.paid_at, u.row_id) as rn
    from customer_payments_unified u
    join cohort ch on ch.customer_id = u.customer_id
    where u.client_id = p_client_id
  )
  select
    (case when rn >= 3 then 3 else rn end)::int as ordinal,
    count(distinct customer_id)::bigint as customers,
    count(*)::bigint as purchases,
    coalesce(sum(amount), 0)::bigint as revenue_paise
  from ranked
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- customers_top — the highest-value customers, for the strip that makes value
-- concentration visceral. A keyed read with a limit, not an aggregation, but it
-- lives here so the cohort rule stays in one place.
-- ---------------------------------------------------------------------------
create or replace function public.customers_top(
  p_client_id uuid,
  p_days int default null,
  p_limit int default 8
)
returns table (
  customer_id uuid,
  name text,
  lifetime_paise bigint,
  purchase_count bigint,
  ad_key text,
  ad_name text,
  campaign_name text,
  days_to_second numeric,
  has_test boolean
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
  )
  select
    v.customer_id,
    v.name,
    v.lifetime_paise::bigint,
    v.purchase_count::bigint,
    v.ad_key,
    v.ad_name,
    v.campaign_name,
    v.days_to_second::numeric,
    v.has_test
  from v_customers_attributed v
  cross join cutoff c
  where v.client_id = p_client_id
    and (c.from_day is null or v.acquired_day_ist >= c.from_day)
  order by v.lifetime_paise desc, v.customer_id
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.customers_kpis(uuid, int)        from public, anon;
revoke execute on function public.customers_by_ad(uuid, int)       from public, anon;
revoke execute on function public.customers_ladder(uuid, int)      from public, anon;
revoke execute on function public.customers_top(uuid, int, int)    from public, anon;

grant execute on function public.customers_kpis(uuid, int)         to authenticated;
grant execute on function public.customers_by_ad(uuid, int)        to authenticated;
grant execute on function public.customers_ladder(uuid, int)       to authenticated;
grant execute on function public.customers_top(uuid, int, int)     to authenticated;

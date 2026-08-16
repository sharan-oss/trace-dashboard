-- Custom date windows + optional cohort-scoped L2 window (2026-08-17).
--
-- WHY: webinar-funnel clients run ads in one window (say Aug 1-15) and collect
-- the back-end/upsell revenue in another (the webinar, Aug 15-16). A single
-- range cannot express that, so the six Overview/Ads aggregates learn two new
-- capabilities:
--
--   1. An explicit L1 window (p_from / p_to) instead of only "last N days".
--      p_from wins over p_days when both arrive; p_to null means unbounded,
--      which is exactly today's behaviour (no upper filter has ever existed).
--
--   2. An optional L2 window (p_l2_from / p_l2_to) on the four L2-bearing
--      functions. When BOTH are non-null the L2 arm switches from
--      "external payment paid inside the L1 window" to
--      "external payment paid inside the L2 window AND its customer was
--       ACQUIRED inside the L1 window" — acquisition read off
--      customers.l1_payment_id -> v_payments_attributed.day_ist, the same
--      acquisition-credit link that already decides WHICH ad an upsell belongs
--      to. Cohort membership is therefore a strict narrowing of today's rule:
--      cohort L2 <= payment-date L2 for the same window, never more.
--
-- DEFAULT PATH IS UNCHANGED. With p_from/p_to/p_l2_* all null the window CTE
-- reduces to the old cutoff CTE, the to_day predicates are vacuously true and
-- l2_split is false — the SQL executed is today's SQL and the numbers are
-- byte-for-byte identical. The TS layer keeps sending p_days for presets.
--
-- DROP + CREATE, never `create or replace`: adding defaulted parameters via
-- replace leaves the old (uuid, int) signature in place as a second overload,
-- and PostgREST then refuses every call with PGRST203 ambiguity. Same reason
-- 20260813090000 dropped ads_breakdown before recreating it. Grants are
-- re-issued against the new argument lists (Supabase's default privileges hand
-- execute to anon at creation time, so both revokes stay explicit).
--
-- Doctrine unchanged everywhere below: security invoker so base-table RLS is
-- the tenant guarantee, p_client_id as defense-in-depth on top; L1 and L2
-- aggregated in separate CTEs then joined (joining first fans out L1 amounts
-- across L2 rows); the external_order_id dedupe guard kept in BOTH modes so
-- provable L1 re-imports are never double-counted; attribution only ever READ
-- off the views, never re-derived here.
--
-- One asymmetry worth stating: in cohort mode an external payment whose
-- customer is unlinked (no customer_id, or no l1_payment_id) has an UNKNOWN
-- acquisition date, so it cannot be proven to belong to the cohort and is
-- excluded. In default mode it still counts, landing in the Unattributed
-- bucket as before.

-- ---------------------------------------------------------------------------
-- overview_kpis
-- ---------------------------------------------------------------------------

drop function if exists public.overview_kpis(uuid, int);

create function public.overview_kpis(
  p_client_id uuid,
  p_days int default null,
  p_from date default null,
  p_to date default null,
  p_l2_from date default null,
  p_l2_to date default null
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
    select coalesce(sum(v.amount), 0)::bigint as revenue,
           count(*)::bigint as cnt
    from v_payments_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
  ),
  l2 as (
    select coalesce(sum(ep.amount), 0)::bigint as revenue,
           count(*)::bigint as cnt
    from external_payments ep
    cross join win w
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
            from customers cu
            join v_payments_attributed va on va.id = cu.l1_payment_id
            where cu.id = ep.customer_id
              and (w.from_day is null or va.day_ist >= w.from_day)
              and (w.to_day is null or va.day_ist <= w.to_day)
          ))
      )
  ),
  s as (
    select count(*)::bigint as cnt
    from v_sessions_attributed v
    cross join win w
    where v.client_id = p_client_id
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
  )
  select l1.revenue, l1.cnt, l2.revenue, l2.cnt, s.cnt
  from l1, l2, s;
$$;

-- ---------------------------------------------------------------------------
-- overview_revenue_daily
--
-- In split mode an L2 payment still buckets to its OWN paid day — only which
-- payments qualify changes, never where they land on the x-axis. The page
-- widens the chart span to the union of both windows so those days are drawn.
-- ---------------------------------------------------------------------------

drop function if exists public.overview_revenue_daily(uuid, int);

create function public.overview_revenue_daily(
  p_client_id uuid,
  p_days int default null,
  p_from date default null,
  p_to date default null,
  p_l2_from date default null,
  p_l2_to date default null
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
    select v.day_ist as d, sum(v.amount)::bigint as revenue
    from v_payments_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
    group by v.day_ist
  ),
  l2 as (
    select (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date as d,
           sum(ep.amount)::bigint as revenue
    from external_payments ep
    cross join win w
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
            from customers cu
            join v_payments_attributed va on va.id = cu.l1_payment_id
            where cu.id = ep.customer_id
              and (w.from_day is null or va.day_ist >= w.from_day)
              and (w.to_day is null or va.day_ist <= w.to_day)
          ))
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

-- ---------------------------------------------------------------------------
-- overview_top_ads
--
-- The customers -> v_payments_attributed left joins already exist here to
-- credit an upsell to the acquiring ad, so cohort membership reuses them
-- rather than a second exists(): `va.id is not null` plus the L1-window bounds
-- is the same predicate overview_kpis expresses as exists(), which is what
-- keeps Σ(per-ad L2) = kpis L2 true in both modes. Both joins are on primary
-- keys, so neither fans out.
-- ---------------------------------------------------------------------------

drop function if exists public.overview_top_ads(uuid, int);

create function public.overview_top_ads(
  p_client_id uuid,
  p_days int default null,
  p_from date default null,
  p_to date default null,
  p_l2_from date default null,
  p_l2_to date default null
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
    select v.ad_key as k,
           max(v.ad_name) as ad_name,
           max(v.campaign_name) as campaign_name,
           sum(v.amount)::bigint as revenue,
           count(distinct v.customer_id)::bigint as customers
    from v_payments_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
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
    cross join win w
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
          and va.id is not null
          and (w.from_day is null or va.day_ist >= w.from_day)
          and (w.to_day is null or va.day_ist <= w.to_day))
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

-- ---------------------------------------------------------------------------
-- ads_breakdown (two-tier: campaign | ad)
-- ---------------------------------------------------------------------------

drop function if exists public.ads_breakdown(uuid, int);

create function public.ads_breakdown(
  p_client_id uuid,
  p_days int default null,
  p_from date default null,
  p_to date default null,
  p_l2_from date default null,
  p_l2_to date default null
)
returns table (
  tier text,
  campaign_key text,
  adset_key text,
  ad_key text,
  campaign_name text,
  adset_name text,
  ad_name text,
  spend_paise bigint,
  impressions bigint,
  clicks bigint,
  l1_revenue_paise bigint,
  l1_paid_count bigint,
  l2_revenue_paise bigint,
  l2_count bigint,
  sessions_count bigint,
  name_matched boolean,
  has_test boolean,
  campaign_tier_only_revenue_paise bigint
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
  spend as (
    select
      case when grouping(a.meta_ad_id) = 0 then 'ad' else 'campaign' end as tier,
      a.meta_campaign_id as ck,
      case when grouping(a.meta_adset_id) = 0 then a.meta_adset_id end as sk,
      case when grouping(a.meta_ad_id) = 0 then a.meta_ad_id end as ak,
      max(a.campaign_name) as c_name,
      max(a.adset_name) as s_name,
      max(a.ad_name) as a_name,
      sum(i.spend_minor)::bigint as spend,
      sum(i.impressions)::bigint as impr,
      sum(i.clicks)::bigint as clk
    from ad_insights_daily i
    join ads a on a.id = i.ad_id
    cross join win w
    where i.client_id = p_client_id
      and (w.from_day is null or i.date_start >= w.from_day)
      and (w.to_day is null or i.date_start <= w.to_day)
    group by grouping sets (
      (a.meta_campaign_id),
      (a.meta_campaign_id, a.meta_adset_id, a.meta_ad_id)
    )
  ),
  l1 as (
    select
      case when grouping(v.ad_key) = 0 then 'ad' else 'campaign' end as tier,
      v.campaign_key as ck,
      case when grouping(v.adset_key) = 0 then v.adset_key end as sk,
      case when grouping(v.ad_key) = 0 then v.ad_key end as ak,
      max(v.campaign_name) as c_name,
      max(v.adset_name) as s_name,
      max(v.ad_name) as a_name,
      sum(v.amount)::bigint as revenue,
      count(*)::bigint as cnt,
      bool_or(v.ad_key_type = 'ad_name') as name_matched,
      bool_or(v.is_test_payment or v.is_test_client) as has_test,
      sum(v.amount) filter (where v.attribution_tier = 'campaign')::bigint as camp_only
    from v_payments_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
    group by grouping sets (
      (v.campaign_key),
      (v.campaign_key, v.adset_key, v.ad_key)
    )
  ),
  l2 as (
    select
      case when grouping(va.ad_key) = 0 then 'ad' else 'campaign' end as tier,
      va.campaign_key as ck,
      case when grouping(va.adset_key) = 0 then va.adset_key end as sk,
      case when grouping(va.ad_key) = 0 then va.ad_key end as ak,
      sum(ep.amount)::bigint as revenue,
      count(*)::bigint as cnt
    from external_payments ep
    left join customers cu on cu.id = ep.customer_id
    left join v_payments_attributed va on va.id = cu.l1_payment_id
    cross join win w
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
          and va.id is not null
          and (w.from_day is null or va.day_ist >= w.from_day)
          and (w.to_day is null or va.day_ist <= w.to_day))
      )
    group by grouping sets (
      (va.campaign_key),
      (va.campaign_key, va.adset_key, va.ad_key)
    )
  ),
  sess as (
    select
      case when grouping(v.ad_key) = 0 then 'ad' else 'campaign' end as tier,
      v.campaign_key as ck,
      case when grouping(v.adset_key) = 0 then v.adset_key end as sk,
      case when grouping(v.ad_key) = 0 then v.ad_key end as ak,
      max(v.campaign_name) as c_name,
      max(v.adset_name) as s_name,
      max(v.ad_name) as a_name,
      count(*)::bigint as cnt,
      bool_or(v.ad_key_type = 'ad_name') as name_matched
    from v_sessions_attributed v
    cross join win w
    where v.client_id = p_client_id
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
    group by grouping sets (
      (v.campaign_key),
      (v.campaign_key, v.adset_key, v.ad_key)
    )
  ),
  united as (
    select tier, ck, sk, ak, c_name, s_name, a_name,
           spend, impr, clk, 0::bigint as l1_rev, 0::bigint as l1_cnt,
           0::bigint as l2_rev, 0::bigint as l2_cnt, 0::bigint as sess_cnt,
           false as name_matched, false as has_test, 0::bigint as camp_only
    from spend
    union all
    select tier, ck, sk, ak, c_name, s_name, a_name,
           0, 0, 0, revenue, cnt, 0, 0, 0, name_matched, has_test, coalesce(camp_only, 0)
    from l1
    union all
    select tier, ck, sk, ak, null, null, null,
           0, 0, 0, 0, 0, revenue, cnt, 0, false, false, 0
    from l2
    union all
    select tier, ck, sk, ak, c_name, s_name, a_name,
           0, 0, 0, 0, 0, 0, 0, cnt, name_matched, false, 0
    from sess
  )
  select
    u.tier,
    u.ck as campaign_key,
    u.sk as adset_key,
    u.ak as ad_key,
    max(u.c_name) as campaign_name,
    max(u.s_name) as adset_name,
    max(u.a_name) as ad_name,
    coalesce(sum(u.spend), 0)::bigint as spend_paise,
    coalesce(sum(u.impr), 0)::bigint as impressions,
    coalesce(sum(u.clk), 0)::bigint as clicks,
    coalesce(sum(u.l1_rev), 0)::bigint as l1_revenue_paise,
    coalesce(sum(u.l1_cnt), 0)::bigint as l1_paid_count,
    coalesce(sum(u.l2_rev), 0)::bigint as l2_revenue_paise,
    coalesce(sum(u.l2_cnt), 0)::bigint as l2_count,
    coalesce(sum(u.sess_cnt), 0)::bigint as sessions_count,
    bool_or(u.name_matched) as name_matched,
    bool_or(u.has_test) as has_test,
    coalesce(sum(u.camp_only), 0)::bigint as campaign_tier_only_revenue_paise
  from united u
  group by u.tier, u.ck, u.sk, u.ak
  order by u.tier, spend_paise desc, l1_revenue_paise desc;
$$;

-- ---------------------------------------------------------------------------
-- ads_summary and overview_spend_daily carry no L2 arm, so they take the L1
-- window only — no dead parameters.
-- ---------------------------------------------------------------------------

drop function if exists public.ads_summary(uuid, int);

create function public.ads_summary(
  p_client_id uuid,
  p_days int default null,
  p_from date default null,
  p_to date default null
)
returns table (
  spend_paise bigint,
  spend_untracked_paise bigint,
  unattributed_l1_revenue_paise bigint,
  unattributed_l1_count bigint
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
      p_to as to_day
  ),
  spend_by_ad as (
    select a.meta_ad_id as ak, sum(i.spend_minor)::bigint as sp
    from ad_insights_daily i
    join ads a on a.id = i.ad_id
    cross join win w
    where i.client_id = p_client_id
      and (w.from_day is null or i.date_start >= w.from_day)
      and (w.to_day is null or i.date_start <= w.to_day)
    group by a.meta_ad_id
  ),
  sess_keys as (
    select distinct v.ad_key
    from v_sessions_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.ad_key is not null
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
  ),
  spend_totals as (
    select
      coalesce(sum(s.sp), 0)::bigint as total,
      coalesce(sum(s.sp) filter (where k.ad_key is null), 0)::bigint as untracked
    from spend_by_ad s
    left join sess_keys k on k.ad_key = s.ak
  ),
  l1_unattributed as (
    select
      coalesce(sum(v.amount), 0)::bigint as revenue,
      count(*)::bigint as cnt
    from v_payments_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
      and (v.ad_key is null
           or not exists (
             select 1 from ads a
             where a.meta_ad_id = v.ad_key
               and a.client_id = v.client_id
           ))
  )
  select st.total, st.untracked, lu.revenue, lu.cnt
  from spend_totals st, l1_unattributed lu;
$$;

drop function if exists public.overview_spend_daily(uuid, int);

create function public.overview_spend_daily(
  p_client_id uuid,
  p_days int default null,
  p_from date default null,
  p_to date default null
)
returns table (
  day date,
  spend_paise bigint,
  l1_paid_count bigint
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
      p_to as to_day
  ),
  united as (
    select i.date_start as d, i.spend_minor::bigint as spend, 0::bigint as paid
    from ad_insights_daily i
    cross join win w
    where i.client_id = p_client_id
      and (w.from_day is null or i.date_start >= w.from_day)
      and (w.to_day is null or i.date_start <= w.to_day)
    union all
    select v.day_ist, 0, 1
    from v_payments_attributed v
    cross join win w
    where v.client_id = p_client_id
      and v.is_paid
      and (w.from_day is null or v.day_ist >= w.from_day)
      and (w.to_day is null or v.day_ist <= w.to_day)
  )
  select u.d as day,
         coalesce(sum(u.spend), 0)::bigint as spend_paise,
         coalesce(sum(u.paid), 0)::bigint as l1_paid_count
  from united u
  group by u.d
  order by u.d;
$$;

-- ---------------------------------------------------------------------------
-- Grants on the new argument lists.
-- ---------------------------------------------------------------------------

revoke execute on function public.overview_kpis(uuid, int, date, date, date, date) from public;
revoke execute on function public.overview_kpis(uuid, int, date, date, date, date) from anon;
grant  execute on function public.overview_kpis(uuid, int, date, date, date, date) to authenticated;

revoke execute on function public.overview_revenue_daily(uuid, int, date, date, date, date) from public;
revoke execute on function public.overview_revenue_daily(uuid, int, date, date, date, date) from anon;
grant  execute on function public.overview_revenue_daily(uuid, int, date, date, date, date) to authenticated;

revoke execute on function public.overview_top_ads(uuid, int, date, date, date, date) from public;
revoke execute on function public.overview_top_ads(uuid, int, date, date, date, date) from anon;
grant  execute on function public.overview_top_ads(uuid, int, date, date, date, date) to authenticated;

revoke execute on function public.ads_breakdown(uuid, int, date, date, date, date) from public;
revoke execute on function public.ads_breakdown(uuid, int, date, date, date, date) from anon;
grant  execute on function public.ads_breakdown(uuid, int, date, date, date, date) to authenticated;

revoke execute on function public.ads_summary(uuid, int, date, date) from public;
revoke execute on function public.ads_summary(uuid, int, date, date) from anon;
grant  execute on function public.ads_summary(uuid, int, date, date) to authenticated;

revoke execute on function public.overview_spend_daily(uuid, int, date, date) from public;
revoke execute on function public.overview_spend_daily(uuid, int, date, date) from anon;
grant  execute on function public.overview_spend_daily(uuid, int, date, date) to authenticated;

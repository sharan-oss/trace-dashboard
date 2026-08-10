-- Slice D aggregate RPCs — the Ads page and the Overview's Meta unlock.
-- Same doctrine as overview_aggregate_rpcs: security invoker (RLS is the
-- guarantee, p_client_id is defense-in-depth), IST windows with p_days null =
-- all time, attribution only ever READ off the views, execute revoked from
-- anon. No raw rows are ever paged into JS to be summed.
--
-- ads_breakdown returns ALL THREE tiers in one call via GROUPING SETS. The
-- four fact sources (spend, L1, L2, sessions) are aggregated separately and
-- combined by UNION ALL + re-GROUP rather than chained FULL JOINs: GROUP BY
-- treats nulls as equal, so the null-key groups (the per-level Unattributed
-- buckets, which the UI renders, never drops) line up without sentinel
-- gymnastics, and nothing can fan out.
--
-- L2 revenue is credited to the ad behind the customer's FIRST L1 purchase
-- (customers.l1_payment_id -> v_payments_attributed keys) — the agreed
-- acquisition-credit rule, copied from overview_top_ads. The external row
-- itself carries no attribution.
--
-- Thumbnails/status are deliberately NOT here: the page reads them off the
-- ads dimension directly (a keyed read, not an aggregation).

create or replace function public.ads_breakdown(
  p_client_id uuid,
  p_days int default null
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
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  spend as (
    select
      case when grouping(a.meta_ad_id) = 0 then 'ad'
           when grouping(a.meta_adset_id) = 0 then 'adset'
           else 'campaign' end as tier,
      a.meta_campaign_id as ck,
      case when grouping(a.meta_adset_id) = 0 then a.meta_adset_id end as sk,
      case when grouping(a.meta_ad_id) = 0 then a.meta_ad_id end as ak,
      max(a.campaign_name) as c_name,
      max(a.adset_name) as s_name,
      max(a.ad_name) as a_name,
      sum(i.spend_minor)::bigint as spend
    from ad_insights_daily i
    join ads a on a.id = i.ad_id
    cross join cutoff c
    where i.client_id = p_client_id
      and (c.from_day is null or i.date_start >= c.from_day)
    group by grouping sets (
      (a.meta_campaign_id),
      (a.meta_campaign_id, a.meta_adset_id),
      (a.meta_campaign_id, a.meta_adset_id, a.meta_ad_id)
    )
  ),
  l1 as (
    select
      case when grouping(v.ad_key) = 0 then 'ad'
           when grouping(v.adset_key) = 0 then 'adset'
           else 'campaign' end as tier,
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
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
    group by grouping sets (
      (v.campaign_key),
      (v.campaign_key, v.adset_key),
      (v.campaign_key, v.adset_key, v.ad_key)
    )
  ),
  l2 as (
    select
      case when grouping(va.ad_key) = 0 then 'ad'
           when grouping(va.adset_key) = 0 then 'adset'
           else 'campaign' end as tier,
      va.campaign_key as ck,
      case when grouping(va.adset_key) = 0 then va.adset_key end as sk,
      case when grouping(va.ad_key) = 0 then va.ad_key end as ak,
      sum(ep.amount)::bigint as revenue,
      count(*)::bigint as cnt
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
    group by grouping sets (
      (va.campaign_key),
      (va.campaign_key, va.adset_key),
      (va.campaign_key, va.adset_key, va.ad_key)
    )
  ),
  sess as (
    select
      case when grouping(v.ad_key) = 0 then 'ad'
           when grouping(v.adset_key) = 0 then 'adset'
           else 'campaign' end as tier,
      v.campaign_key as ck,
      case when grouping(v.adset_key) = 0 then v.adset_key end as sk,
      case when grouping(v.ad_key) = 0 then v.ad_key end as ak,
      max(v.campaign_name) as c_name,
      max(v.adset_name) as s_name,
      max(v.ad_name) as a_name,
      count(*)::bigint as cnt,
      bool_or(v.ad_key_type = 'ad_name') as name_matched
    from v_sessions_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and (c.from_day is null or v.day_ist >= c.from_day)
    group by grouping sets (
      (v.campaign_key),
      (v.campaign_key, v.adset_key),
      (v.campaign_key, v.adset_key, v.ad_key)
    )
  ),
  united as (
    select tier, ck, sk, ak, c_name, s_name, a_name,
           spend, 0::bigint as l1_rev, 0::bigint as l1_cnt,
           0::bigint as l2_rev, 0::bigint as l2_cnt, 0::bigint as sess_cnt,
           false as name_matched, false as has_test, 0::bigint as camp_only
    from spend
    union all
    select tier, ck, sk, ak, c_name, s_name, a_name,
           0, revenue, cnt, 0, 0, 0, name_matched, has_test, coalesce(camp_only, 0)
    from l1
    union all
    select tier, ck, sk, ak, null, null, null,
           0, 0, 0, revenue, cnt, 0, false, false, 0
    from l2
    union all
    select tier, ck, sk, ak, c_name, s_name, a_name,
           0, 0, 0, 0, 0, cnt, name_matched, false, 0
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

-- The reconciliation figures the Ads page must show rather than hide:
-- spend that produced no tracked session, and paid revenue no ad can claim.
-- Tiles combine this with overview_kpis; no revenue/session definitions are
-- duplicated here.
create or replace function public.ads_summary(
  p_client_id uuid,
  p_days int default null
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
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  spend_by_ad as (
    select a.meta_ad_id as ak, sum(i.spend_minor)::bigint as sp
    from ad_insights_daily i
    join ads a on a.id = i.ad_id
    cross join cutoff c
    where i.client_id = p_client_id
      and (c.from_day is null or i.date_start >= c.from_day)
    group by a.meta_ad_id
  ),
  sess_keys as (
    select distinct v.ad_key
    from v_sessions_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and v.ad_key is not null
      and (c.from_day is null or v.day_ist >= c.from_day)
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
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
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

-- Daily spend + L1 paid count for the Overview's Spends and CPA chart tabs.
-- Daily CPA is a per-point display division client-side, not an aggregation.
create or replace function public.overview_spend_daily(
  p_client_id uuid,
  p_days int default null
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
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  united as (
    select i.date_start as d, i.spend_minor::bigint as spend, 0::bigint as paid
    from ad_insights_daily i
    cross join cutoff c
    where i.client_id = p_client_id
      and (c.from_day is null or i.date_start >= c.from_day)
    union all
    select v.day_ist, 0, 1
    from v_payments_attributed v
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
  )
  select u.d as day,
         coalesce(sum(u.spend), 0)::bigint as spend_paise,
         coalesce(sum(u.paid), 0)::bigint as l1_paid_count
  from united u
  group by u.d
  order by u.d;
$$;

revoke execute on function public.ads_breakdown(uuid, int) from public;
revoke execute on function public.ads_breakdown(uuid, int) from anon;
grant  execute on function public.ads_breakdown(uuid, int) to authenticated;

revoke execute on function public.ads_summary(uuid, int) from public;
revoke execute on function public.ads_summary(uuid, int) from anon;
grant  execute on function public.ads_summary(uuid, int) to authenticated;

revoke execute on function public.overview_spend_daily(uuid, int) from public;
revoke execute on function public.overview_spend_daily(uuid, int) from anon;
grant  execute on function public.overview_spend_daily(uuid, int) to authenticated;

-- Ads restructure (2026-08-13): ads_breakdown goes two-tier and learns
-- impressions/clicks.
--
-- The Ads section is now Campaigns | Ads (ad sets demoted to a label/filter on
-- ad rows), so the adset grouping set is dropped: tier ∈ {'campaign','ad'}.
-- Ad rows still carry adset_key/adset_name — they remain grouping columns —
-- for the ad-set chip and filter in the cards view.
--
-- impressions/clicks have been synced into ad_insights_daily since Slice B but
-- were never surfaced; they now ride the spend CTE so the UI can derive CTR
-- (clicks/impressions) and CPM (spend/impressions*1000) — pure Meta-native
-- math, no attribution logic involved.
--
-- Return type changes, so this must DROP and recreate (create or replace
-- cannot change OUT columns), and the grants are re-issued below. All other
-- doctrine is unchanged from 20260810150000_ads_ui_aggregate_rpcs.sql:
-- security invoker, IST windows with p_days null = all time, UNION ALL +
-- re-GROUP (null-key Unattributed groups line up, nothing fans out), L2
-- acquisition credit via customers.l1_payment_id.

drop function if exists public.ads_breakdown(uuid, int);

create function public.ads_breakdown(
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
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
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
    cross join cutoff c
    where i.client_id = p_client_id
      and (c.from_day is null or i.date_start >= c.from_day)
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
    cross join cutoff c
    where v.client_id = p_client_id
      and v.is_paid
      and (c.from_day is null or v.day_ist >= c.from_day)
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
    cross join cutoff c
    where v.client_id = p_client_id
      and (c.from_day is null or v.day_ist >= c.from_day)
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

revoke execute on function public.ads_breakdown(uuid, int) from public;
revoke execute on function public.ads_breakdown(uuid, int) from anon;
grant  execute on function public.ads_breakdown(uuid, int) to authenticated;

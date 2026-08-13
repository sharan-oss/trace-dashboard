-- Guard the STORED Meta ids the same way the extracted ones already are.
--
-- Live finding (2026-08-13, caught by tests/v-sessions-attributed.test.ts):
-- Trace's capture writes sessions/payments.ad_id/adset_id/campaign_id from the
-- raw URL params, and clicks on unexpanded URL templates deliver literal
-- macros — 8 sessions + 1 payment stored '{{ad.id}}'/'{{adset.id}}'/
-- '{{campaign.id}}', and 11 sessions stored '_removed_'. The extraction path
-- rejects these via metric_normalize_ad_id (the '^[0-9]{6,}$' rule, unit-
-- tested against exactly these shapes), but the stored path was a bare
-- coalesce(stored, extracted) that trusted the column as-is, so the views
-- emitted '{{ad.id}}' as an ad_id-typed key — a garbage "ad" every consumer
-- (ads_breakdown, the Ads cards) would render.
--
-- Fix: wrap all six stored reads in metric_normalize_ad_id. The function's
-- rule is "a Meta numeric id, 6+ digits" — the identical shape for ad, ad set
-- and campaign ids, so reusing it at all three levels keeps one definition.
-- A guarded-out row falls back to URL/params extraction, and if that also
-- resolves nothing it lands in the Unattributed bucket — the correct meaning
-- of "attribution unresolved", per the data model's null semantics.
--
-- Only the resolved-CTE expressions change; both column lists are untouched,
-- so create-or-replace suffices. security_invoker stays load-bearing.

create or replace view public.v_sessions_attributed
with (security_invoker = true) as
with resolved as (
  select
    s.*,
    coalesce(public.metric_normalize_ad_id(s.ad_id), public.metric_ad_id_from_url(s.landing_url)) as ad_id_resolved,
    coalesce(public.metric_normalize_ad_id(s.adset_id), public.metric_adset_id_from_url(s.landing_url)) as adset_id_resolved,
    coalesce(public.metric_normalize_ad_id(s.campaign_id), public.metric_campaign_id_from_url(s.landing_url)) as campaign_id_resolved,
    public.metric_normalize_key(s.utm_content) as ad_name_raw
  from public.sessions s
),
keyed as (
  select
    r.*,
    nic.meta_ad_id as ad_id_from_name
  from resolved r
  left join public.v_ad_name_resolution nic
    on r.ad_id_resolved is null
   and nic.client_id = r.client_id
   and nic.meta_campaign_id = r.campaign_id_resolved
   and nic.ad_name = r.ad_name_raw
)
select
  k.id, k.client_id, k.product_id, k.fingerprint,
  k.utm_source, k.utm_medium, k.utm_campaign, k.utm_content, k.utm_term,
  k.fbclid, k.gclid, k.utm_params, k.campaign_id, k.adset_id, k.ad_id,
  k.referrer, k.landing_url,
  k.device_ram_gb, k.device_cpu_cores, k.device_brand, k.device_model,
  k.device_os, k.device_os_version,
  k.network_type, k.network_speed_kbps, k.fcp_ms, k.tti_ms,
  k.created_at,
  public.metric_clean_utm_source(k.utm_source) as utm_source_clean,
  coalesce(k.ad_id_resolved, k.ad_id_from_name) as ad_key,
  case
    when k.ad_id_resolved is not null then 'ad_id'
    when k.ad_id_from_name is not null then 'ad_name'
    else 'none'
  end as ad_key_type,
  coalesce(k.adset_id_resolved, a.meta_adset_id) as adset_key,
  coalesce(k.campaign_id_resolved, a.meta_campaign_id) as campaign_key,
  case
    when coalesce(k.ad_id_resolved, k.ad_id_from_name) is not null then 'ad'
    when coalesce(k.adset_id_resolved, a.meta_adset_id) is not null then 'adset'
    when coalesce(k.campaign_id_resolved, a.meta_campaign_id) is not null then 'campaign'
    else 'none'
  end as attribution_tier,
  a.ad_name,
  a.adset_name,
  a.campaign_name,
  (k.created_at at time zone 'Asia/Kolkata')::date as day_ist
from keyed k
left join public.ads a
  on a.meta_ad_id = coalesce(k.ad_id_resolved, k.ad_id_from_name)
 and a.client_id = k.client_id;

create or replace view public.v_payments_attributed
with (security_invoker = true) as
with resolved as (
  select
    p.*,
    coalesce(public.metric_normalize_ad_id(p.ad_id), public.metric_ad_id_from_params(p.utm_params)) as ad_id_resolved,
    coalesce(public.metric_normalize_ad_id(p.adset_id), public.metric_adset_id_from_params(p.utm_params)) as adset_id_resolved,
    coalesce(public.metric_normalize_ad_id(p.campaign_id), public.metric_campaign_id_from_params(p.utm_params)) as campaign_id_resolved,
    public.metric_normalize_key(p.utm_params ->> 'utm_content') as ad_name_raw
  from public.payments p
),
keyed as (
  select
    r.*,
    nic.meta_ad_id as ad_id_from_name
  from resolved r
  left join public.v_ad_name_resolution nic
    on r.ad_id_resolved is null
   and nic.client_id = r.client_id
   and nic.meta_campaign_id = r.campaign_id_resolved
   and nic.ad_name = r.ad_name_raw
)
select
  k.id, k.client_id, k.session_id, k.product_id,
  k.order_id, k.payment_id, k.gateway, k.status,
  k.amount, k.currency,
  k.customer_name, k.customer_email, k.customer_phone,
  k.utm_source, k.utm_medium, k.utm_campaign, k.fbclid, k.gclid,
  k.utm_params, k.customer_data, k.raw_payload,
  k.campaign_id, k.adset_id, k.ad_id, k.landing_url,
  k.visit_count, k.minutes_to_convert,
  k.created_at, k.paid_at,
  public.metric_clean_utm_source(k.utm_source) as utm_source_clean,
  coalesce(k.ad_id_resolved, k.ad_id_from_name) as ad_key,
  case
    when k.ad_id_resolved is not null then 'ad_id'
    when k.ad_id_from_name is not null then 'ad_name'
    else 'none'
  end as ad_key_type,
  coalesce(k.adset_id_resolved, a.meta_adset_id) as adset_key,
  coalesce(k.campaign_id_resolved, a.meta_campaign_id) as campaign_key,
  case
    when coalesce(k.ad_id_resolved, k.ad_id_from_name) is not null then 'ad'
    when coalesce(k.adset_id_resolved, a.meta_adset_id) is not null then 'adset'
    when coalesce(k.campaign_id_resolved, a.meta_campaign_id) is not null then 'campaign'
    else 'none'
  end as attribution_tier,
  a.ad_name,
  a.adset_name,
  a.campaign_name,
  (k.status = 'paid' or k.paid_at is not null) as is_paid,
  (k.amount <= 500) as is_test_payment,
  coalesce(starts_with(c.razorpay_key_id, 'rzp_test'), false) as is_test_client,
  (coalesce(k.paid_at, k.created_at) at time zone 'Asia/Kolkata')::date as day_ist,
  k.customer_id
from keyed k
left join public.ads a
  on a.meta_ad_id = coalesce(k.ad_id_resolved, k.ad_id_from_name)
 and a.client_id = k.client_id
left join public.clients c on c.id = k.client_id;

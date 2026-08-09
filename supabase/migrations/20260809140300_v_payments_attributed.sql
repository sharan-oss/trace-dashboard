-- Three-tier attributed read layer over payments. Mirrors
-- v_sessions_attributed exactly, except the raw source is the utm_params jsonb
-- rather than a URL query string, and the test-row marking is added.
--
-- THE clients JOIN EXISTS ONLY to derive is_test_client. It must stay a
-- projection of that single boolean: `select c.*` here would expose
-- razorpay_key_secret_enc / razorpay_webhook_secret_enc / tagmango_*_enc, which
-- are AES-256-GCM ciphertext this dashboard must never read. LEFT join, so a
-- payment can never vanish because its client row is invisible.
--
-- starts_with() rather than LIKE 'rzp\_test%', so the underscore cannot be
-- misread as a single-character wildcard.
--
-- is_paid is `status = 'paid' OR paid_at IS NOT NULL` because a few rows are
-- paid with a null paid_at. day_ist prefers paid_at so revenue buckets on the
-- day the money actually arrived.
--
-- is_test_payment is a PAYMENT-level rule, not a product-level one: test
-- products get repriced to their real value after roughly five transactions, so
-- a product flag would retroactively misclassify that product's whole history.
-- payments.amount is sourced server-side at payment time, so those rows keep
-- the Rs 1 value permanently. Test rows stay visible and stay in totals -- they
-- are badged, never filtered.
create or replace view public.v_payments_attributed
with (security_invoker = true) as
with resolved as (
  select
    p.*,
    coalesce(p.ad_id, public.metric_ad_id_from_params(p.utm_params)) as ad_id_resolved,
    coalesce(p.adset_id, public.metric_adset_id_from_params(p.utm_params)) as adset_id_resolved,
    coalesce(p.campaign_id, public.metric_campaign_id_from_params(p.utm_params)) as campaign_id_resolved,
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
  -- Appended last, deliberately: `create or replace view` can only add columns
  -- at the end, never insert them mid-list, so putting this beside the other
  -- customer_* columns would force a drop-and-recreate. Column order is
  -- irrelevant here — every caller selects by name.
  --
  -- customer_id links an L1 payment to its customer, and through
  -- customers.l1_payment_id onward to that customer's later L2 purchases in
  -- external_payments. It is the join key for ad -> L1 -> customer -> L2, which
  -- is the entire point of the attribution product. Added 2026-08-10 once the
  -- column appeared on payments; the base-column parity test in
  -- tests/v-payments-attributed.test.ts caught its absence, which is exactly
  -- what that test exists for.
  k.customer_id
from keyed k
left join public.ads a
  on a.meta_ad_id = coalesce(k.ad_id_resolved, k.ad_id_from_name)
 and a.client_id = k.client_id
left join public.clients c on c.id = k.client_id;

grant select on public.v_payments_attributed to anon, authenticated;

-- Three-tier attributed read layer over sessions.
--
-- security_invoker = true is load-bearing: without it the view runs as its
-- owner and silently bypasses RLS on sessions and ads, which is a tenant leak.
--
-- KEY RESOLUTION, in strict order:
--   1. The stored column (backfilled once for Love School, and eventually
--      written by Trace's capture) wins.
--   2. Otherwise extract from the raw landing_url via the shared metric_*
--      functions. This is what carries every client that was never backfilled
--      -- Occultyogis has zero stored ids but ~2,000 extractable ad ids -- and
--      every row that arrived after the backfill.
--   3. Only if no id resolved at all, fall back to a campaign-scoped ad NAME.
--
-- WHY THE NAME MATCH IS SCOPED: ad names are not unique. 14 of Love School's
-- 49 names are reused across ads, and one name is duplicated inside a single
-- campaign. public.v_ad_name_resolution (see its own migration) keeps only
-- names mapping to exactly one ad within one campaign for one client;
-- anything ambiguous resolves nothing and lands in the ad-level Unattributed
-- bucket rather than being guessed. The client_id in its grouping key
-- matters: without it an admin, who can see every client's ads, could match
-- one client's name against another's ad. That view is a standalone,
-- directly-testable unit rather than an inline CTE here so both guards have
-- their own test coverage independent of session data.
--
-- EVERY JOIN TO ads IS A LEFT JOIN. A client with no seeded ads (Occultyogis
-- today) must still resolve ad keys from extraction; only the display names and
-- the completed hierarchy degrade to null. Both joins are on unique or
-- deduplicated keys, so neither can multiply rows.
create or replace view public.v_sessions_attributed
with (security_invoker = true) as
with resolved as (
  select
    s.*,
    coalesce(s.ad_id, public.metric_ad_id_from_url(s.landing_url)) as ad_id_resolved,
    coalesce(s.adset_id, public.metric_adset_id_from_url(s.landing_url)) as adset_id_resolved,
    coalesce(s.campaign_id, public.metric_campaign_id_from_url(s.landing_url)) as campaign_id_resolved,
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

grant select on public.v_sessions_attributed to anon, authenticated;

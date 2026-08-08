-- One-time Love School normalisation backfill (decided with Sharan 2026-08-09).
-- Fills the new campaign_id / adset_id / ad_id columns on sessions and
-- payments for client cb7daf9d-28f1-4699-a587-afb6e2ec44da ONLY.
--
-- Rules (verified against Meta's own hierarchy export before running):
--   Tier 1, exact ids: ad id via the shared metric_* extraction; campaign id
--     from utm_id; adset id from fbc_id, else utm_term when it passes the
--     numeric guard (utm_term provably carries {{adset.id}} in one template
--     era and the adset NAME in another -- the guard separates them).
--   Tier 2, scoped name: a row with no ad id resolves utm_content against
--     ads, but only when that name maps to exactly ONE ad within the row's
--     campaign. Ad names are NOT globally unique (14 of Love School's 49
--     names are reused across ads), so an unscoped name match would misattribute.
--   Tier 3, hierarchy completion: a resolved ad fills its adset/campaign from
--     ads, which wins over the raw extracted value (canonical hierarchy).
--
-- Safety: null-fill only -- coalesce(existing, ...) means a non-null value is
-- never overwritten, and no pre-existing column is touched at all. The final
-- IS DISTINCT FROM guard makes a re-run update zero rows (idempotent).

with name_in_campaign as (
  select meta_campaign_id, ad_name, min(meta_ad_id) as meta_ad_id
  from public.ads
  where client_id = 'cb7daf9d-28f1-4699-a587-afb6e2ec44da'
  group by 1, 2
  having count(distinct meta_ad_id) = 1
),
resolved as (
  select s.id,
    coalesce(x.ad_id_key, nc.meta_ad_id) as ad_id_final,
    x.campaign_key,
    x.adset_key
  from public.sessions s
  cross join lateral (
    select
      public.metric_ad_id_from_url(s.landing_url) as ad_id_key,
      public.metric_campaign_id_from_url(s.landing_url) as campaign_key,
      coalesce(
        public.metric_normalize_ad_id((regexp_match(s.landing_url, '[?&]fbc_id=([^&#]*)', 'i'))[1]),
        public.metric_normalize_ad_id(s.utm_term)
      ) as adset_key
  ) x
  left join name_in_campaign nc
    on x.ad_id_key is null
   and nc.meta_campaign_id = x.campaign_key
   and nc.ad_name = public.metric_normalize_key(s.utm_content)
  where s.client_id = 'cb7daf9d-28f1-4699-a587-afb6e2ec44da'
)
update public.sessions s
set
  ad_id       = coalesce(s.ad_id, a.meta_ad_id, r.ad_id_final),
  adset_id    = coalesce(s.adset_id, a.meta_adset_id, r.adset_key),
  campaign_id = coalesce(s.campaign_id, a.meta_campaign_id, r.campaign_key)
from resolved r
left join public.ads a on a.meta_ad_id = r.ad_id_final
where s.id = r.id
  and (
    s.ad_id       is distinct from coalesce(s.ad_id, a.meta_ad_id, r.ad_id_final)
    or s.adset_id    is distinct from coalesce(s.adset_id, a.meta_adset_id, r.adset_key)
    or s.campaign_id is distinct from coalesce(s.campaign_id, a.meta_campaign_id, r.campaign_key)
  );

with name_in_campaign as (
  select meta_campaign_id, ad_name, min(meta_ad_id) as meta_ad_id
  from public.ads
  where client_id = 'cb7daf9d-28f1-4699-a587-afb6e2ec44da'
  group by 1, 2
  having count(distinct meta_ad_id) = 1
),
resolved as (
  select p.id,
    coalesce(x.ad_id_key, nc.meta_ad_id) as ad_id_final,
    x.campaign_key,
    x.adset_key
  from public.payments p
  cross join lateral (
    select
      public.metric_ad_id_from_params(p.utm_params) as ad_id_key,
      public.metric_normalize_key(p.utm_params ->> 'utm_id') as campaign_key,
      coalesce(
        public.metric_normalize_ad_id(p.utm_params ->> 'fbc_id'),
        public.metric_normalize_ad_id(p.utm_params ->> 'utm_term')
      ) as adset_key
  ) x
  left join name_in_campaign nc
    on x.ad_id_key is null
   and nc.meta_campaign_id = x.campaign_key
   and nc.ad_name = public.metric_normalize_key(p.utm_params ->> 'utm_content')
  where p.client_id = 'cb7daf9d-28f1-4699-a587-afb6e2ec44da'
)
update public.payments p
set
  ad_id       = coalesce(p.ad_id, a.meta_ad_id, r.ad_id_final),
  adset_id    = coalesce(p.adset_id, a.meta_adset_id, r.adset_key),
  campaign_id = coalesce(p.campaign_id, a.meta_campaign_id, r.campaign_key)
from resolved r
left join public.ads a on a.meta_ad_id = r.ad_id_final
where p.id = r.id
  and (
    p.ad_id       is distinct from coalesce(p.ad_id, a.meta_ad_id, r.ad_id_final)
    or p.adset_id    is distinct from coalesce(p.adset_id, a.meta_adset_id, r.adset_key)
    or p.campaign_id is distinct from coalesce(p.campaign_id, a.meta_campaign_id, r.campaign_key)
  );

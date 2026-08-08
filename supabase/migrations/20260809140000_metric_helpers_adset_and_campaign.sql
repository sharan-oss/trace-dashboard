-- Ad set extraction, plus the campaign key widened to the new URL template.
--
-- WHY THE CAMPAIGN WIDENING IS URGENT: the original helper read only utm_id.
-- Sharan's standard template emits campaign_id={{campaign.id}}, and 29 live
-- sessions already carry campaign_id with no utm_id. Every one of them resolves
-- no campaign today, and that count grows with every ad that adopts the template.
--
-- WHY utm_term NEEDS THE NUMERIC GUARD: utm_term provably carries the ad set ID
-- in one template era and the ad set NAME in another. The numeric guard is the
-- only thing separating them. Without it, ad set names would be joined against
-- ad set ids and resolve nothing while looking attributed.
--
-- fbc_id is the AD SET id. It is NOT fbclid, which is Meta's click id. The
-- anchored patterns keep them apart -- never use LIKE '%fbc_id%', which matches
-- fbclid because `_` is a single-character wildcard in LIKE.
--
-- Both extractors use the same scan-then-filter shape as metric_ad_id_from_url:
-- take the first value that passes the guard, not the first key that matches.

-- Campaign id key variants. The new template emits `campaign_id`; older rows
-- carry `utm_id`. Both mean the Meta campaign id.
create or replace function public.metric_campaign_id_key_pattern()
returns text language sql immutable parallel safe as $$
  select '(?:utm_id|campaign_id)'
$$;

-- Ad set id key variants. fbc_id is what both the old and the new template
-- emit; adset_id is accepted for symmetry; utm_term is the legacy era and is
-- only trusted when it passes the numeric guard.
create or replace function public.metric_adset_id_key_pattern()
returns text language sql immutable parallel safe as $$
  select '(?:fbc_id|adset_id|utm_term)'
$$;

-- Campaign id from a URL query string. Junk filter only, NO numeric guard:
-- campaign ids are numeric for the paying clients, but the test client
-- legitimately uses 'june-test-01'. Requiring digits would silently drop it.
create or replace function public.metric_campaign_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(m[1])
  from regexp_matches(
    url,
    '[?&]' || public.metric_campaign_id_key_pattern() || '=([^&#]*)',
    'gi'
  ) as m
  where public.metric_normalize_key(m[1]) is not null
  limit 1
$$;

-- Campaign id from the jsonb params. Only the named keys are ever read: the
-- utm_params key space is unbounded because campaign names leak in as keys,
-- so nothing may enumerate keys generically.
create or replace function public.metric_campaign_id_from_params(params jsonb)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(e.value)
  from jsonb_each_text(
    case when jsonb_typeof(params) = 'object' then params else '{}'::jsonb end
  ) as e
  where e.key ~* ('^' || public.metric_campaign_id_key_pattern() || '$')
    and public.metric_normalize_key(e.value) is not null
  limit 1
$$;

-- Ad set id from a URL query string. Numeric guard applies to every variant,
-- which is what makes reading utm_term safe.
create or replace function public.metric_adset_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(m[1])
  from regexp_matches(
    url,
    '[?&]' || public.metric_adset_id_key_pattern() || '=([^&#]*)',
    'gi'
  ) as m
  where public.metric_normalize_ad_id(m[1]) is not null
  limit 1
$$;

-- Ad set id from the jsonb params.
create or replace function public.metric_adset_id_from_params(params jsonb)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(e.value)
  from jsonb_each_text(
    case when jsonb_typeof(params) = 'object' then params else '{}'::jsonb end
  ) as e
  where e.key ~* ('^' || public.metric_adset_id_key_pattern() || '$')
    and public.metric_normalize_ad_id(e.value) is not null
  limit 1
$$;

grant execute on function
  public.metric_campaign_id_key_pattern(),
  public.metric_adset_id_key_pattern(),
  public.metric_campaign_id_from_url(text),
  public.metric_campaign_id_from_params(jsonb),
  public.metric_adset_id_from_url(text),
  public.metric_adset_id_from_params(jsonb)
to anon, authenticated;

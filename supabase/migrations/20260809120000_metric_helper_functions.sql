-- Shared extraction rules for the dashboard's metrics read layer.
--
-- These live in `public` (not a private schema) so they are reachable over
-- PostgREST RPC and can be unit-tested directly from the test suite. That is
-- safe: every function here is a pure text/jsonb transform that reads no
-- table and holds no secret. They are the ONE definition of each rule —
-- v_sessions_attributed and v_payments_attributed compose them rather than
-- re-implementing the regexes, so a new key variant is a one-line change here.
--
-- Anchored regexes throughout. Never LIKE '%h_ad_id%': in LIKE, `_` is a
-- single-character wildcard, so '%fbc_id%' matches 'fbclid'.

-- The ad-identifier key variants, as one pattern used by both the URL side
-- (sessions.landing_url, where a space is encoded as `+` or `%20`) and the
-- jsonb side (payments.utm_params, where keys are already decoded).
-- Covers: h_ad_id, ad_id, Ad_id, Ad ID, Ad+ID, Ad%20ID, Ad%2BID (double-encoded
-- `+`, confirmed real by the sibling `Adset%2Bcontent` key on the same
-- client), adid.
create or replace function public.metric_ad_id_key_pattern()
returns text language sql immutable parallel safe as $$
  select '(?:h_ad_id|ad(?:_|\+|%20|%2b|\s)?id)'
$$;

-- A Meta ad identifier is always a long integer. Anything else is junk:
-- unexpanded macros ({{ad.id}} / %7b%7bad.id%7d%7d), the literal strings
-- 'null' and '_removed_', or an empty value. Rejecting these stops phantom
-- ads appearing in every breakdown.
create or replace function public.metric_normalize_ad_id(raw text)
returns text language sql immutable parallel safe as $$
  select case when raw ~ '^[0-9]{6,}$' then raw end
$$;

-- Generic junk filter for non-numeric keys (campaign ids, ad names). Campaign
-- ids are numeric for the paying clients but not universally — the test client
-- uses 'june-test-01' — so this must not require digits.
create or replace function public.metric_normalize_key(raw text)
returns text language sql immutable parallel safe as $$
  select case
    when raw is null then null
    when btrim(raw) = '' then null
    when lower(btrim(raw)) in ('null', 'undefined', '_removed_') then null
    when raw ~* '(\{\{|%7b%7b)' then null
    else btrim(raw)
  end
$$;

-- Repairs the capture bug where the parameter key leaked into its own value,
-- splitting one traffic source across two rows ('utm_source=METAxAM' and
-- 'METAxAM'). Read-layer repair only; the capture fix belongs in the Trace repo.
create or replace function public.metric_clean_utm_source(raw text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(
    regexp_replace(raw, '^utm_source=', '', 'i')
  )
$$;

-- First ad identifier in a URL query string, or null. Scans every occurrence
-- of the key pattern and returns the first one that normalizes to a valid ad
-- id, mirroring metric_ad_id_from_params below: a junk match earlier in the
-- string (an unexpanded macro, a stray param) must not shadow a valid one
-- later in it.
create or replace function public.metric_ad_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(m[1])
  from regexp_matches(
    url,
    '[?&]' || public.metric_ad_id_key_pattern() || '=([^&#]*)',
    'gi'
  ) as m
  where public.metric_normalize_ad_id(m[1]) is not null
  limit 1
$$;

-- First ad identifier among the jsonb keys, or null. Only keys matching the
-- shared variant pattern are ever read by name: the utm_params key space is
-- unbounded because campaign names leak into it as keys, so nothing may
-- enumerate keys generically. The jsonb_typeof guard keeps a non-object
-- payload from raising.
create or replace function public.metric_ad_id_from_params(params jsonb)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(e.value)
  from jsonb_each_text(
    case when jsonb_typeof(params) = 'object' then params else '{}'::jsonb end
  ) as e
  where e.key ~* ('^' || public.metric_ad_id_key_pattern() || '$')
    and public.metric_normalize_ad_id(e.value) is not null
  limit 1
$$;

-- Campaign identifier from a URL query string. Junk filter only, no numeric
-- guard: campaign ids are numeric for the paying clients but not for all.
create or replace function public.metric_campaign_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(
    (regexp_match(url, '[?&]utm_id=([^&#]*)', 'i'))[1]
  )
$$;

grant execute on function
  public.metric_ad_id_key_pattern(),
  public.metric_normalize_ad_id(text),
  public.metric_normalize_key(text),
  public.metric_clean_utm_source(text),
  public.metric_ad_id_from_url(text),
  public.metric_ad_id_from_params(jsonb),
  public.metric_campaign_id_from_url(text)
to anon, authenticated;

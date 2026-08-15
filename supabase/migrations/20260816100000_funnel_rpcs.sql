-- Funnel section data layer (design: docs/superpowers/specs/2026-08-16-funnel-section-design.md).
--
-- Architecture A, deliberately: v_funnel_by_session stays pure stages-per-
-- session, and these RPCs compose it with sessions (landing_url, telemetry)
-- and v_sessions_attributed (campaign/ad keys) at read time. Fattening the
-- funnel view would re-derive attribution in a second place — the drift the
-- view layer exists to prevent.
--
-- Doctrine as every aggregate before: security invoker (RLS is the guarantee,
-- p_client_id is defense-in-depth), IST day windows with p_days null = all
-- time, counts only — every ratio is computed in TypeScript through the
-- null-safe ratio() family, so nothing here can ever emit NaN or Infinity.

-- ---------------------------------------------------------------------------
-- metric_normalize_landing_page — the single definition of "which page".
--
-- sessions.landing_url arrives with protocol, UTM query junk and fragments;
-- grouping on it raw fragments one page into hundreds of segments. Normalised:
-- lowercase, protocol stripped, cut at ? and #, trailing slash collapsed.
-- Verified live 2026-08-16: this collapses each client's traffic to a handful
-- of real pages (Occultyogis: two LP variants at 7,458 and 6,613 sessions).
-- ---------------------------------------------------------------------------
create or replace function public.metric_normalize_landing_page(p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  -- lower() runs FIRST: the protocol regex is case-sensitive, and real traffic
  -- contains 'HTTPS://' (caught by the apply-time probe on 2026-08-16).
  select nullif(
    rtrim(
      regexp_replace(
        lower(split_part(split_part(coalesce(p_url, ''), '?', 1), '#', 1)),
        '^https?://', ''
      ),
      '/'
    ),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- funnel_overview — the stage card and the wasted-clicks strip.
--
-- never_loaded: sessions that fired no page_load at all — paid clicks that
-- never became visitors (8.4% for Love School when this shipped).
-- no_telemetry: sessions with no network reading. Its converted count is
-- returned FROM DATA rather than assumed zero — live it is exactly 0, and the
-- strip must keep being honest if that ever changes.
-- ---------------------------------------------------------------------------
create or replace function public.funnel_overview(
  p_client_id uuid,
  p_days int default null
)
returns table (
  sessions bigint,
  reached_page_load bigint,
  reached_form_open bigint,
  reached_form_start bigint,
  reached_form_submit bigint,
  reached_payment_open bigint,
  reached_payment_complete bigint,
  never_loaded bigint,
  no_telemetry bigint,
  no_telemetry_converted bigint
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
    count(*)::bigint,
    count(*) filter (where f.reached_page_load)::bigint,
    count(*) filter (where f.reached_form_open)::bigint,
    count(*) filter (where f.reached_form_start)::bigint,
    count(*) filter (where f.reached_form_submit)::bigint,
    count(*) filter (where f.reached_payment_open)::bigint,
    count(*) filter (where f.reached_payment_complete)::bigint,
    count(*) filter (where not f.reached_page_load)::bigint,
    count(*) filter (where s.network_speed_kbps is null)::bigint,
    count(*) filter (where s.network_speed_kbps is null
                       and f.reached_payment_complete)::bigint
  from v_funnel_by_session f
  join sessions s on s.id = f.session_id
  cross join cutoff c
  where f.client_id = p_client_id
    and (c.from_day is null or f.day_ist >= c.from_day);
$$;

-- ---------------------------------------------------------------------------
-- funnel_breakdown — the segment table, one RPC for all four lenses.
--
-- The lens pair is the page's whole argument:
--   campaign lens = same page, different traffic  -> the ad's fault
--   page lens     = same traffic, different page  -> the page's fault
-- product is the owner's coarse cut; ad is the drill inside one campaign.
--
-- Null-key buckets (Unattributed / unknown page / no product) are emitted
-- always — dropping them would make the table stop summing to the overview,
-- and reconciliation is asserted by test, not hoped for.
-- ---------------------------------------------------------------------------
create or replace function public.funnel_breakdown(
  p_client_id uuid,
  p_days int default null,
  p_dimension text default 'campaign',
  p_campaign text default null
)
returns table (
  segment_key text,
  segment_label text,
  sessions bigint,
  reached_page_load bigint,
  reached_form_open bigint,
  reached_form_start bigint,
  reached_form_submit bigint,
  reached_payment_open bigint,
  reached_payment_complete bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_dimension not in ('campaign', 'page', 'product', 'ad') then
    raise exception 'funnel_breakdown: unknown dimension %', p_dimension;
  end if;
  if p_dimension = 'ad' and p_campaign is null then
    raise exception 'funnel_breakdown: dimension ''ad'' requires p_campaign';
  end if;

  return query
  with cutoff as (
    select case
      when p_days is null then null::date
      else (now() at time zone 'Asia/Kolkata')::date - (p_days - 1)
    end as from_day
  ),
  base as (
    select
      f.reached_page_load as r1,
      f.reached_form_open as r2,
      f.reached_form_start as r3,
      f.reached_form_submit as r4,
      f.reached_payment_open as r5,
      f.reached_payment_complete as r6,
      case p_dimension
        when 'campaign' then sa.campaign_key
        when 'ad'       then sa.ad_key
        when 'page'     then metric_normalize_landing_page(s.landing_url)
        when 'product'  then f.product_id::text
      end as seg
    from v_funnel_by_session f
    join sessions s on s.id = f.session_id
    left join v_sessions_attributed sa on sa.id = f.session_id
    cross join cutoff c
    where f.client_id = p_client_id
      and (c.from_day is null or f.day_ist >= c.from_day)
      and (p_dimension <> 'ad' or sa.campaign_key = p_campaign)
  )
  select
    b.seg as segment_key,
    case p_dimension
      when 'campaign' then coalesce(
        (select max(a.campaign_name) from ads a
          where a.meta_campaign_id = b.seg and a.client_id = p_client_id),
        b.seg)
      when 'ad' then coalesce(
        (select max(a.ad_name) from ads a
          where a.meta_ad_id = b.seg and a.client_id = p_client_id),
        b.seg)
      when 'page' then b.seg
      when 'product' then coalesce(
        (select max(p.name) from products p
          where p.id::text = b.seg and p.client_id = p_client_id),
        b.seg)
    end as segment_label,
    count(*)::bigint as sessions,
    count(*) filter (where b.r1)::bigint,
    count(*) filter (where b.r2)::bigint,
    count(*) filter (where b.r3)::bigint,
    count(*) filter (where b.r4)::bigint,
    count(*) filter (where b.r5)::bigint,
    count(*) filter (where b.r6)::bigint
  from base b
  group by b.seg
  order by sessions desc, segment_key nulls last;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Both RPCs are authenticated-only, and the funnel view loses the
-- residual anon SELECT its 2026-08-09 migration granted — RLS already returns
-- anon zero rows through it (security_invoker), but the role behind the
-- browser-shipped publishable key should hold no grant at all. Same cleanup
-- the L2 adopt-migration performed on customer_spend.
-- ---------------------------------------------------------------------------
revoke select on public.v_funnel_by_session from anon;

revoke execute on function public.metric_normalize_landing_page(text) from public, anon;
grant  execute on function public.metric_normalize_landing_page(text) to authenticated;

revoke execute on function public.funnel_overview(uuid, int) from public, anon;
grant  execute on function public.funnel_overview(uuid, int) to authenticated;

revoke execute on function public.funnel_breakdown(uuid, int, text, text) from public, anon;
grant  execute on function public.funnel_breakdown(uuid, int, text, text) to authenticated;

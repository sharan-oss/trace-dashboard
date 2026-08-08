-- The ads dimension table: one row per Meta ad, carrying its full
-- campaign -> adset -> ad hierarchy and names. Pulled forward from Slice B
-- (02-meta-ads-sync.md) so Slice A's attribution and the Love School
-- normalisation can resolve against it now; the nightly Meta sync later
-- upserts onto meta_ad_id and takes over freshness.
--
-- Dashboard-owned table (unlike Trace's five core read-only tables), so it
-- carries deliberate write policies: WITH CHECK requiring the is_admin claim,
-- per .claude/rules/auth-security.md. ad_account_id stays a bare uuid until
-- Slice B creates ad_accounts; the FK is added there.

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  ad_account_id uuid,
  meta_ad_id text not null unique,
  meta_adset_id text not null,
  meta_campaign_id text not null,
  ad_name text not null,
  adset_name text not null,
  campaign_name text not null,
  status text not null default 'active',
  creative_thumbnail_path text,
  creative_source_url text,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create index ads_client_idx on public.ads (client_id);
create index ads_campaign_idx on public.ads (meta_campaign_id);
create index ads_adset_idx on public.ads (meta_adset_id);

alter table public.ads enable row level security;

create policy "dashboard_read_ads"
  on public.ads
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_ads"
  on public.ads
  for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_ads"
  on public.ads
  for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

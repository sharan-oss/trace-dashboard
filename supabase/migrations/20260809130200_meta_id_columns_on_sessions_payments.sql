-- Additive Meta hierarchy columns on sessions and payments: campaign_id,
-- adset_id, ad_id (values mirror ads.meta_*). Part of the Love School one-time
-- normalisation decided 2026-08-09: new columns are FILLED by the backfill,
-- no existing column is ever overwritten (utm_source, utm_term, utm_params,
-- landing_url stay byte-for-byte as the audit trail).
--
-- Nullable, no defaults: Trace's insert paths are unaffected. Going forward
-- these stay null until Trace's capture writes them directly (the new Ads
-- Manager template puts all three ids in the URL); Slice A views bridge with
-- coalesce(stored, extracted).

-- `if not exists` on every column: Trace's own repository adds these same
-- three columns independently, and the two repos' migration timelines are
-- interleaved in production, so replaying this file against a database that
-- already carries Trace's current schema must not fail with "column already
-- exists". The columns already exist live -- this file is not re-applied,
-- only made safe to replay.
alter table public.sessions
  add column if not exists campaign_id text,
  add column if not exists adset_id text,
  add column if not exists ad_id text;

alter table public.payments
  add column if not exists campaign_id text,
  add column if not exists adset_id text,
  add column if not exists ad_id text;

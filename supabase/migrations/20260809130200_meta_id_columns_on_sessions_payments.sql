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

alter table public.sessions
  add column campaign_id text,
  add column adset_id text,
  add column ad_id text;

alter table public.payments
  add column campaign_id text,
  add column adset_id text,
  add column ad_id text;

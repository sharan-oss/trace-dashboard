-- Store each ad's Meta creative id (2026-08-17).
--
-- WHY: creative images are fetched from the account's creative library, a
-- separate paged read from the ad listing — expanding the 720px creative
-- inline makes an /ads page so expensive Meta refuses it outright on a large
-- account. Joining the two therefore needs the creative id, and re-deriving it
-- means re-walking every ad, which defeats the incremental dimension sync that
-- keeps a run inside the API tier's score budget.
--
-- Nullable and additive: rows synced before this migration simply carry null
-- until their next full walk, and a null only ever means "no creative resolved
-- yet", never "this ad has no creative".

alter table public.ads add column if not exists meta_creative_id text;

comment on column public.ads.meta_creative_id is
  'Meta creative id, joined against the account creative library to resolve creative_source_url. Null = not yet resolved.';

create index if not exists ads_creative_lookup_idx
  on public.ads (ad_account_id)
  where creative_source_url is null;

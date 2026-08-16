-- Store each ad's Meta ASSET identifiers (2026-08-17).
--
-- WHY: fetching creative previews by asking Meta to render a thumbnail per ad
-- is the expensive path — thumbnail_width/height are documented as "Rendered",
-- i.e. a cold image resize per row, which forces page size down to 25 and
-- turns one account into a ~102-call walk against a 60-point/300s budget.
--
-- The assets are all addressable WITHOUT any render: an image_hash or a
-- video_id arrives as plain JSON on the creative, and both resolve through
-- account-level library edges (/adimages, /advideos) that page in bulk and
-- cost the same whether the account has 2,540 ads or 25,000.
--
-- Hashes are scattered across the data model — sometimes on the creative,
-- sometimes only inside object_story_spec or asset_feed_spec — so the sync
-- resolves them from several places and stores whichever it finds here.
--
-- Both nullable and additive: null means "not resolved yet", never "this ad
-- has no creative".

alter table public.ads add column if not exists meta_image_hash text;
alter table public.ads add column if not exists meta_video_id text;

comment on column public.ads.meta_image_hash is
  'Meta image library hash, resolved via /act_X/adimages to a permanent URL. Null = unresolved.';
comment on column public.ads.meta_video_id is
  'Meta video library id, resolved via /act_X/advideos to a poster frame. Null = unresolved.';

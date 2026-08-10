-- Private Storage bucket for mirrored Meta creative thumbnails (AC-11).
--
-- Meta's own thumbnail URLs are signed and expire, so the sync mirrors the
-- image bytes here and stores the object path on ads.creative_thumbnail_path.
-- Object paths are '{client_id}/{meta_ad_id}.jpg': the leading folder IS the
-- tenant boundary, so the select policy scopes reads structurally and the
-- short-lived signed URLs Slice D mints inherit tenant separation.
--
-- Writes (and deletes, for test cleanup and re-mirrors) are admin-only, same
-- as every dashboard-owned table.

insert into storage.buckets (id, name, public)
values ('ad-creatives', 'ad-creatives', false)
on conflict (id) do nothing;

create policy "ad_creatives_read"
  on storage.objects for select
  using (
    bucket_id = 'ad-creatives'
    and (
      (auth.jwt() ->> 'is_admin')::boolean is true
      or (storage.foldername(name))[1] = auth.jwt() ->> 'client_id'
    )
  );

create policy "ad_creatives_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'ad-creatives'
    and (auth.jwt() ->> 'is_admin')::boolean is true
  );

create policy "ad_creatives_update"
  on storage.objects for update
  using (
    bucket_id = 'ad-creatives'
    and (auth.jwt() ->> 'is_admin')::boolean is true
  )
  with check (
    bucket_id = 'ad-creatives'
    and (auth.jwt() ->> 'is_admin')::boolean is true
  );

create policy "ad_creatives_delete"
  on storage.objects for delete
  using (
    bucket_id = 'ad-creatives'
    and (auth.jwt() ->> 'is_admin')::boolean is true
  );

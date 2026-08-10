-- Admin-gated delete on ads.
--
-- Slice A created ads with read/insert/update policies only — at that point
-- nothing ever deleted a dimension row. Slice B's test suite runs against the
-- live database and exercises the sync's upsert path with clearly-marked
-- fixture ads (meta_ad_id 'test_sync_ad_%'); without a delete policy, RLS
-- makes their cleanup silently affect zero rows and fixtures accumulate in the
-- live dimension. The sync itself still never deletes (absent ads are marked
-- inactive in Slice C); this is maintenance-and-test hygiene only.

create policy "dashboard_delete_ads"
  on public.ads for delete
  using ((auth.jwt() ->> 'is_admin')::boolean is true);

grant delete on public.ads to authenticated;

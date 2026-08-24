-- One live run per account, enforced by the database rather than a
-- SELECT-then-INSERT check that can race (Sync-now vs the 2:30 AM IST cron,
-- or a double-click). The stale-run lease in sync.ts closes orphans
-- (status -> 'failed') before any insert, so a killed process releases this
-- lock within STALE_RUN_MAX_AGE_MS. A lost race surfaces as a unique
-- violation (23505) which the engine reports as a clean conflict/409.
create unique index ad_sync_runs_one_running_per_account
  on public.ad_sync_runs (ad_account_id)
  where status = 'running';

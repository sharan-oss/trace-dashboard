-- The three remaining Slice B tables. `ads` already exists (created early so
-- Slice A's attribution could resolve against it); this adds the account,
-- insights and run-log tables around it and finally wires up ads.ad_account_id.
--
-- The run log is ad_sync_runs, NOT the plan's original sync_runs: that name
-- was taken on 2026-08-10 by the Razorpay L2 sync log, which has a different
-- shape and logs a different job. The two must never merge (see STATUS.md).
--
-- All three are dashboard-owned, unlike Trace's five core read-only tables, so
-- each carries deliberate WITH CHECK write policies gated on the is_admin
-- claim. In Postgres a USING-only policy denies writes outright, and the
-- service-role key is forbidden inside a request handler, so this is the only
-- way the sync can write at all.
--
-- Every table carries client_id so RLS is a direct column check with no join.

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  meta_ad_account_id text not null unique,
  name text not null,
  currency text not null,
  timezone_name text not null,
  status text not null default 'active',
  -- Nullable, unused in this slice. Reserved so a future per-client OAuth
  -- connect flow can store its own token reference without restructuring;
  -- the System User path leaves this null.
  token_ref text,
  connected_at timestamptz not null default now()
);

create index ad_accounts_client_idx on public.ad_accounts (client_id);

create table public.ad_insights_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  ad_id uuid not null references public.ads(id),
  date_start date not null,
  -- Integer minor units (paise). Never numeric, never float.
  spend_minor bigint not null default 0,
  currency text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  raw jsonb,
  synced_at timestamptz not null default now(),
  -- This constraint is what makes the entire sync idempotent: every write is
  -- an upsert on it, so re-running any window is always safe.
  unique (ad_id, date_start)
);

create index ad_insights_daily_client_date_idx
  on public.ad_insights_daily (client_id, date_start);

create table public.ad_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  ad_account_id uuid references public.ad_accounts(id),
  kind text not null check (kind in ('backfill', 'nightly', 'manual')),
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  date_from date,
  date_to date,
  meta_report_id text,
  ads_synced integer not null default 0,
  rows_upserted integer not null default 0,
  api_calls integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index ad_sync_runs_account_started_idx
  on public.ad_sync_runs (ad_account_id, started_at desc);

-- ads.ad_account_id was left a bare uuid because ad_accounts did not exist yet.
alter table public.ads
  add constraint ads_ad_account_id_fkey
  foreign key (ad_account_id) references public.ad_accounts(id);

alter table public.ad_accounts enable row level security;
alter table public.ad_insights_daily enable row level security;
alter table public.ad_sync_runs enable row level security;

create policy "dashboard_read_ad_accounts"
  on public.ad_accounts for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_ad_accounts"
  on public.ad_accounts for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_ad_accounts"
  on public.ad_accounts for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_read_ad_insights_daily"
  on public.ad_insights_daily for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_ad_insights_daily"
  on public.ad_insights_daily for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_ad_insights_daily"
  on public.ad_insights_daily for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_read_ad_sync_runs"
  on public.ad_sync_runs for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_ad_sync_runs"
  on public.ad_sync_runs for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_ad_sync_runs"
  on public.ad_sync_runs for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

-- ad_accounts deliberately has NO delete policy: disconnecting an account
-- flips status, never removes history (AC-7). The fact and log tables do get
-- an admin-gated delete — without one, RLS makes DELETE silently affect zero
-- rows, so test cleanup and re-sync corrections would quietly no-op.

create policy "dashboard_delete_ad_insights_daily"
  on public.ad_insights_daily for delete
  using ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_delete_ad_sync_runs"
  on public.ad_sync_runs for delete
  using ((auth.jwt() ->> 'is_admin')::boolean is true);

grant select on public.ad_accounts to anon, authenticated;
grant select on public.ad_insights_daily to anon, authenticated;
grant select on public.ad_sync_runs to anon, authenticated;
grant insert, update on public.ad_accounts to authenticated;
grant insert, update, delete on public.ad_insights_daily to authenticated;
grant insert, update, delete on public.ad_sync_runs to authenticated;

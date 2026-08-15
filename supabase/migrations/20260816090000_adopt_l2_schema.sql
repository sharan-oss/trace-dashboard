-- Adopt the L2 (upsell) schema into version control.
--
-- customers, external_payments, sync_runs and the two views over them were
-- created directly against the live database on 2026-08-09, and have existed in
-- NO repository's migrations ever since. This repo already owns a migration that
-- ALTERs them (20260810090000_l2_tables_rls_and_view_invoker.sql, the security
-- fix), so it adopts them here rather than leaving the Customers section built
-- on objects that no migration defines.
--
-- Every statement is guarded (create table if not exists / create or replace
-- view) and transcribes the CURRENT live DDL exactly, read out of pg_catalog on
-- 2026-08-16. Applying it to the live project is a no-op; applying it to an
-- empty database reproduces the schema. Idempotent, safe to re-run.
--
-- ONE EXCEPTION, deliberate: the `revoke select ... from anon` at the bottom is
-- a real change, not a no-op. anon still holds SELECT on both views today —
-- 20260810090000 closed the leak by making them security_invoker, so anon reads
-- zero rows, but the grant itself was never withdrawn. Revoking it turns an
-- empty result into an outright permission denial, matching how every RPC and
-- the definition probe already treat anon. anon is the role behind the
-- publishable key, which ships to the browser, so it should not hold select on
-- a view of customer PII under any circumstances.
--
-- Trace's own backend owns every WRITE to these tables through the service-role
-- key. This dashboard is read-only against them, which is why the policies added
-- by 20260810090000 are USING-only and are NOT repeated here.

-- ---------------------------------------------------------------------------
-- customers — the identity spine. One row per real person per client, matched
-- on normalised email/phone. l1_payment_id points at the payment that acquired
-- them, which is what lets an upsell be credited back to an ad.
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  email_norm    text,
  phone_norm    text,
  name          text not null default ''::text,
  l1_payment_id uuid references public.payments(id) on delete set null,
  first_paid_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A customer with neither identifier could never be matched to anything.
  check (email_norm is not null or phone_norm is not null)
);

-- Partial uniques: identity is per client, and only over the identifiers that
-- are actually present (a null email must not collide with another null email).
create unique index if not exists customers_client_email_uq
  on public.customers using btree (client_id, email_norm)
  where email_norm is not null;

create unique index if not exists customers_client_phone_uq
  on public.customers using btree (client_id, phone_norm)
  where phone_norm is not null;

-- The other half of the identity spine: Trace's own payments carry the customer
-- they resolved to. Additive and nullable, so this is a no-op on the live table
-- and does not constitute a write to Trace's core data — the column is already
-- there. Declared here because customer_payments_unified below reads it, and a
-- from-empty build would otherwise fail to create that view.
alter table public.payments
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- external_payments — payments that never touched Trace's checkout (the upsell
-- sold on a bare Razorpay payment link). Pulled by Trace's own Razorpay sync.
-- ---------------------------------------------------------------------------
create table if not exists public.external_payments (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  customer_id         uuid references public.customers(id) on delete set null,
  source              text not null check (source in ('razorpay', 'tagmango')),
  external_payment_id text not null,
  external_order_id   text,
  status              text not null,
  amount              integer not null,
  currency            text not null default 'INR'::text,
  customer_name       text not null default ''::text,
  customer_email      text not null default ''::text,
  customer_phone      text not null default ''::text,
  email_norm          text,
  phone_norm          text,
  description         text,
  raw_payload         jsonb not null default '{}'::jsonb,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  product_name        text,
  unique (client_id, source, external_payment_id)
);

create index if not exists external_payments_client_paid_at_idx
  on public.external_payments using btree (client_id, paid_at);

create index if not exists external_payments_customer_idx
  on public.external_payments using btree (customer_id);

create index if not exists external_payments_unlinked_idx
  on public.external_payments using btree (client_id)
  where customer_id is null;

-- ---------------------------------------------------------------------------
-- sync_runs — the Razorpay L2 ingestion log. NOTE the name collision hazard
-- recorded in docs/STATUS.md: this table is the RAZORPAY sync log and was taken
-- first, which is why the Meta ads sync log had to be named ad_sync_runs.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  source       text not null default 'razorpay'::text check (source in ('razorpay', 'tagmango')),
  triggered_by text not null check (triggered_by in ('cron', 'manual')),
  window_from  timestamptz not null,
  window_to    timestamptz not null,
  status       text not null check (status in ('running', 'ok', 'error')),
  pulled       integer not null default 0,
  inserted     integer not null default 0,
  deduped      integer not null default 0,
  reconciled   integer not null default 0,
  linked       integer not null default 0,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists sync_runs_client_started_idx
  on public.sync_runs using btree (client_id, started_at desc);

-- RLS is enabled on all three (read policies live in 20260810090000). Enabling
-- is idempotent, and matters when this migration builds a database from empty:
-- without it the policies from that migration would have no effect.
alter table public.customers         enable row level security;
alter table public.external_payments enable row level security;
alter table public.sync_runs         enable row level security;

-- ---------------------------------------------------------------------------
-- The two views, transcribed from their live definitions. Both are
-- security_invoker (set by 20260810090000, restated here so a from-empty build
-- is correct too) — without it they bypass RLS on every base table they read,
-- which is exactly the leak that migration was written to close.
-- ---------------------------------------------------------------------------

-- Every purchase by an identified customer, from both worlds, in one shape.
-- 'trace' rows are payments through Trace's checkout; 'external' rows are the
-- upsells. Payments with no customer_id are excluded by design: they cannot be
-- attributed to a person, so they cannot contribute to anyone's lifetime value.
create or replace view public.customer_payments_unified as
  select
    p.customer_id,
    p.client_id,
    'trace'::text as origin,
    p.gateway as source,
    p.id as row_id,
    p.amount,
    p.currency,
    coalesce(p.paid_at, p.created_at) as paid_at,
    pr.name as product_name
  from public.payments p
  left join public.products pr on pr.id = p.product_id
  where p.status = 'paid'::text
    and p.customer_id is not null
  union all
  select
    ep.customer_id,
    ep.client_id,
    'external'::text as origin,
    ep.source,
    ep.id as row_id,
    ep.amount,
    ep.currency,
    coalesce(ep.paid_at, ep.created_at) as paid_at,
    ep.product_name
  from public.external_payments ep
  where ep.status = 'captured'::text
    and ep.customer_id is not null;

-- One row per customer with their purchase count and lifetime spend. LEFT JOIN,
-- so a customer whose payments are all unlinked still appears with a zero.
create or replace view public.customer_spend as
  select
    c.id as customer_id,
    c.client_id,
    c.email_norm,
    c.phone_norm,
    c.name,
    c.l1_payment_id,
    c.first_paid_at,
    count(u.row_id) as purchase_count,
    coalesce(sum(u.amount), (0)::bigint) as lifetime_amount,
    max(u.paid_at) as last_paid_at
  from public.customers c
  left join public.customer_payments_unified u on u.customer_id = c.id
  group by c.id;

alter view public.customer_spend             set (security_invoker = on);
alter view public.customer_payments_unified  set (security_invoker = on);

-- Supabase grants select to anon/authenticated by default on new objects in
-- public. anon holds the publishable key, which ships to the browser, so it must
-- never reach customer PII. This is the one statement here that changes the live
-- database (see the header note).
revoke select on public.customer_spend            from anon;
revoke select on public.customer_payments_unified from anon;
grant  select on public.customer_spend            to authenticated;
grant  select on public.customer_payments_unified to authenticated;

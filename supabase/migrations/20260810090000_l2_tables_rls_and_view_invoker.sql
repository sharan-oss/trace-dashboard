-- SECURITY FIX: close a live tenant-data and PII leak on the L2 objects.
--
-- The L2 ingestion tables (customers, external_payments, sync_runs) and the two
-- views over them (customer_spend, customer_payments_unified) were created
-- directly against the live database on 2026-08-09. Two mistakes combined into
-- an unauthenticated data leak:
--
--   1. Both views were created WITHOUT security_invoker, so they execute with
--      their owner's privileges and bypass RLS on every base table they read --
--      customers, external_payments AND payments.
--   2. Both views grant select to anon and authenticated (Supabase's default
--      privileges for new objects in public).
--
-- Measured before this migration, querying as the `anon` role -- which is what
-- anyone holding the publishable key gets, and that key ships to the browser:
--
--   customer_spend             -> 652 rows, spanning 2 different clients
--   customer_payments_unified  -> 688 rows
--   customers (base table)     -> 0 rows   (RLS correctly denying)
--   external_payments (base)   -> 0 rows   (RLS correctly denying)
--
-- customer_spend exposes email_norm, phone_norm, name, purchase_count and
-- lifetime_amount, so every customer's email, phone and lifetime spend for all
-- clients was readable with no login and no tenant scoping. This is exactly the
-- failure .claude/rules/auth-security.md names: "a view that bypasses row level
-- security is a tenant data leak."
--
-- The two halves of the fix must land together. security_invoker alone would
-- leave the dashboard reading nothing, because the base tables have RLS enabled
-- with ZERO policies -- in Postgres that is deny-all, which is why the leak was
-- invisible: the views were the only path that read these tables at all.
--
-- Read policies only, matching 20260707000000_dashboard_rls_policies.sql. No
-- WITH CHECK: Trace owns every write to these tables through the service-role
-- key, and this dashboard stays read-only against them.

-- 1. Make the views respect the caller's RLS instead of the owner's.
alter view public.customer_spend set (security_invoker = on);
alter view public.customer_payments_unified set (security_invoker = on);

-- 2. Give the base tables the read policies they never had, so admin and
--    client identities can legitimately reach their own rows.
create policy "dashboard_read_customers"
  on public.customers
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_read_external_payments"
  on public.external_payments
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_read_sync_runs"
  on public.sync_runs
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

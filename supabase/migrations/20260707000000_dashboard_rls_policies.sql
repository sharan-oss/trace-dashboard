-- Read-only RLS policies for the Trace Dashboard.
-- Grants: admin (is_admin JWT claim) sees every row; a client's own logged-in
-- user (client_id JWT claim) sees only their own rows. No WITH CHECK clauses —
-- this dashboard never writes to these tables.
--
-- clients is matched on its own `id` (it IS the tenant); the other four
-- tables are matched on their `client_id` foreign key. All matched columns
-- already have supporting indexes (clients.id is the PK; products/sessions/
-- events lead their composite (client_id, ...) indexes; payments has a
-- dedicated payments_client_idx) — no new indexes needed.

create policy "dashboard_read_clients"
  on clients
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_read_products"
  on products
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_read_sessions"
  on sessions
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_read_events"
  on events
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_read_payments"
  on payments
  for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

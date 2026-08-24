-- Off-platform payments (GPay / bank transfer straight to the coach) have no
-- gateway feed and are recorded by an admin by hand until the add-transaction
-- feature ships. 'manual' keeps their provenance honest — the method and who
-- recorded them live in description/raw_payload. Sharan-instructed 2026-08-24.
-- (Trace's Gateway TS type and 005_customer_sync.sql still know only
-- razorpay|tagmango — harmless, Trace's sync only ever writes 'razorpay'.)
alter table public.external_payments
  drop constraint external_payments_source_check;
alter table public.external_payments
  add constraint external_payments_source_check
  check (source in ('razorpay', 'tagmango', 'manual'));

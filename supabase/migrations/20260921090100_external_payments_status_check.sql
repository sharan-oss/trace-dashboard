-- external_payments.status had no CHECK: a hand-typed 'paid' would silently
-- vanish from every upsell number (docs/STATUS.md flagged this on every manual
-- row). Trace's Razorpay pull filters to status === 'captured' BEFORE writing
-- (src/modules/sync/razorpay-pull.service.ts) and its 005 migration never
-- writes another value, so this cannot break the sync. 'voided' is the
-- dashboard's correction state (void_manual_payment, 20260921090000).
-- NOT VALID + VALIDATE so a stray legacy value would fail loudly at validate
-- time rather than blocking the ADD. Pre-flight 2026-09-21: 74 rows, all
-- 'captured'. Sharan-signed-off DDL on a Trace-owned table.
alter table public.external_payments
  add constraint external_payments_status_check
  check (status in ('captured', 'voided')) not valid;
alter table public.external_payments
  validate constraint external_payments_status_check;

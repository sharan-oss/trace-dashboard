# ADR 004: The dashboard writes hand-recorded payments to Trace's L2 tables through security-invoker RPCs under RLS

**Date:** 2026-09-21
**Status:** Accepted (Sharan signed off the DDL in chat, 2026-09-21)

## Decision

Off-platform upsells (GPay / bank transfer / cash straight to the coach) are recorded from the dashboard into `public.external_payments` (`source='manual'`) and, when the buyer never came through Trace's checkout, into `public.customers` — via two `security invoker` Postgres functions, `record_manual_payment` and `void_manual_payment` (migration `20260921090000`), called with the caller's own RLS-scoped cookie client from a Next.js Server Action. New insert/update policies on both tables carry deliberate `WITH CHECK` clauses; column-level grants replace Supabase's default table-level ALL; `external_payments.status` is now `CHECK (status in ('captured','voided'))` (`20260921090100`). Corrections are **void-only**: a row is never edited or deleted, only flipped to `voided` with who/when/why in `raw_payload`.

This supersedes the "this dashboard is read-only against customers / external_payments" contract in the headers of `20260810090000` and `20260816090000`. Trace's own sync still owns every synced row and is untouched.

## Reasoning

- **Eight rows had been inserted by raw SQL** (`docs/STATUS.md`), and the last batch surfaced every failure mode of that path: a near double-count (a "GPay" payment that Razorpay had already synced as UPI), a `status` column with no CHECK where a typo silently deletes revenue, and customer PII living in a status doc. A form with validation, a same-day duplicate guard and an audit trail is what a top-tier billing product does (Chargebee's `record_payment`, Stripe's Payment Records — see `docs/superpowers/research/2026-09-21-offline-payment-recording.md`).
- **RPC, not two PostgREST inserts:** supabase-js cannot wrap two statements in a transaction; a customer created without its payment (or vice versa) would be a half-record. `security invoker` keeps every read and write inside the function under the caller's RLS, so a client user cannot reach another tenant's customer — it simply is not found.
- **Never the service-role key** (ADR 001, `.claude/rules/auth-security.md`): the write policies are the authorization, and the insert policy *forces* `raw_payload->>'recorded_by' = lower(jwt.email)`, so the audit trail cannot be forged (the same trick `app_users.invited_by` uses).
- **Create-a-customer is the one deliberate divergence from Trace's sync**, which drops external payments whose buyer has no L1 customer. A real off-platform sale by a walk-in buyer is revenue; dropping it would understate L2. Such a customer gets `first_paid_at = paid_at` and a null `l1_payment_id`, so they land in Unattributed.
- **Never merge:** when the typed email and phone match two different customers, Trace's sync would merge them (repointing payments, deleting the loser). That is a destructive multi-table write across Trace-owned data; the dashboard returns a `conflict` outcome and lets the operator pick.
- **Void, not delete** (Chargebee "record an offline refund", Stripe's append-only Payment Records; Zoho's free delete is the anti-pattern). Every aggregate already filters `status='captured'`, so a voided row leaves every number at once while the sheet still shows it struck through.
- **Normalisation is mirrored, not shared:** Trace's `normalizeEmail`/`normalizePhone` live in its TS; there was no SQL function. `identity_normalize_email/phone` in Postgres and `src/lib/payments/normalize.ts` are byte-for-byte twins, parity-tested on shared fixtures (`tests/manual-payments.test.ts`).

## Trade-offs

- **`first_paid_at` can move.** If an L2-only customer later buys through Trace's checkout, Trace's `recompute_client_l1` sets `first_paid_at` to that later L1 date; their cohort day shifts and `first_paid_at != min(paid_at)` for that person. Accepted for v1. Fix if it bites: `least(first_paid_at, min(external paid_at))` in `v_customers_attributed`. Trace may also merge such a customer into another it later finds — it repoints `external_payments.customer_id` before deleting the loser, so no payment is orphaned.
- **Two test-hygiene delete policies exist in production**, scoped to rows recorded by / customers addressed at `@trace.local` (a domain no Google account can hold, used only by the suite's two identities). Anything else is void-only.
- **The status CHECK sits on a Trace-owned table.** Safe for today's sync (its pull filters to `captured` before writing); if Trace ever writes `refunded`, its sync fails loudly rather than silently — which is the point.
- **The design doc's "no modals" rule is amended**: URL-driven right-anchored sheets are now the dashboard's drill-down *and* lightweight-entry idiom (customer sheet, day drill-down, record payment). Create/edit of anything heavier still gets its own route.

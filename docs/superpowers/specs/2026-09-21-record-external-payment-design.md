# Record external payments from the dashboard

> Plan drafted 2026-09-21 (Fable) for implementation by Opus. Decisions confirmed by Sharan in chat. Research: codebase patterns, Trace's customer-sync rules (`/Users/sharanv/apps/Trace/src/modules/sync/identity.service.ts`, live DB), and how Stripe / Chargebee / Zoho / QBO / Razorpay / Base UI / Next 16 / Supabase do this (cited in the research memo, to be saved as `docs/superpowers/research/2026-09-21-offline-payment-recording.md`).

## Context

Off-platform upsells (GPay / bank transfer straight to the coach) never touch a gateway feed. Today they are hand-inserted into `public.external_payments` as `source='manual'` via raw SQL — eight rows so far, each a reminder in `docs/STATUS.md:81` that "the add-transaction flow is still owed". The last batch (five rows for Sunday 13 Sept) surfaced every failure mode of the raw path: a near double-count (Ritu already synced from Razorpay as UPI), a `status` column with **no CHECK** where a typo silently deletes revenue, and PII living in a status doc because there was nowhere else to put it.

Goal: coaches (client users) and the team record these payments themselves from the dashboard, matching the sync's data shape byte-for-byte so every existing view/RPC keeps counting them, with a duplicate guard, an audit trail, and void-only corrections.

## Decisions (confirmed by Sharan)

| Question | Decision |
|---|---|
| Who can record | Admin/team (`is_admin`) **and** client users for their own `client_id` |
| Buyer not yet a customer | **Create a new `customers` row** (name + email and/or phone). Counted in L2 revenue; shows Unattributed (no L1 → no acquiring ad) |
| Corrections | **Void only, admin/team only.** Row stays, `status='voided'` + who/when/why in `raw_payload`; excluded from every number (all aggregates already filter `status='captured'`). No edits |
| Entry mode | One at a time with **"Record another"** (keeps date/amount/method/product; mints a new idempotency key). Bulk/CSV = v2 |
| Placement | **Right-side sheet** (same `Dialog` shell as `CustomerSheet`), URL-driven: `?record=1` from the Customers header, `?record=<customer_id>` prefilled from a customer's sheet. Design doc's "no modals" rule amended for URL-driven sheets |
| Architecture | **A: Postgres RPC (`security invoker`) + RLS insert/update policies.** This answer is Sharan's sign-off for DDL on the Trace-owned `customers`/`external_payments` tables (policies, grants, status CHECK) |

## Data contract (verified against Trace + live DB)

- **No triggers** on `customers`/`external_payments`/`payments`. All linking is Trace app code. Trace's Razorpay sync upserts on `(client_id,'razorpay',external_payment_id)` with `ignoreDuplicates`, only ever writes `status='captured'`, and **drops** external payments whose buyer has no L1 customer — creating a customer is our one deliberate divergence.
- **Normalisation** (no SQL fn exists; mirror Trace's TS exactly): email = `trim` + `lower`, `null` if length ≤ 3 or no `@`. Phone = strip non-digits, `null` if < 10 digits, else **last 10**. **Never `''`** (partial unique indexes + `CHECK(email_norm is not null or phone_norm is not null)`).
- **Matching:** look up email and phone **independently** within the client. Same row → use. Different rows → *conflict* (Trace merges; the dashboard must not — surface it). One hit → use (no backfill in v1). Neither → create with `first_paid_at = paid_at` (so cohort/People ranges include them), `l1_payment_id` null. Trace's `recompute_client_l1` only rewrites customers that have a `payments` row, so it won't fight us until that person buys an L1 (see Risks).
- **Row shape** (mirrors the 8 existing manual rows): `source='manual'`, `external_payment_id='manual_' || <uuid idempotency key>` (unique per submission, retry-safe — replaces the `manual_gpay_<phone>_<date>` convention which collides on two same-day payments), `external_order_id` **null** (the aggregates anti-join it against `payments.order_id`), `status='captured'`, `amount` integer paise, `currency='INR'`, `customer_name/email/phone` + `email_norm/phone_norm` from the resolved customer, `description` human sentence, `product_name` ≤200, `paid_at = <day> 12:00 IST`, `raw_payload = {manual_entry:true, method, reference?, note?, recorded_by:<caller email>, recorded_at, idempotency_key, paid_day_ist, time_approximate:true, confirmed_duplicate?}`. `raw_payload.method` is user-visible via `payment_method` → `src/lib/payment-origin.ts` ("GPay · recorded by hand").
- **Duplicate guard** (the Ritu case): same customer + same IST day + same amount, any source, `status='captured'` → soft `outcome:'duplicate'` unless `p_confirm_duplicate`.
- **Void:** `status='voided'`, `raw_payload ||= {voided_by, voided_at, void_reason}`; only `source='manual'` and `status='captured'`; admin only.

## Reuse (verified paths)

- Action template: `src/app/(dashboard)/settings/users/actions.ts` + `add-user-form.tsx` (zod `safeParse` → `ActionState` → `useActionState` → `revalidatePath`; PG code mapping). Caller's cookie client `createServerClient()` — never `createSyncClient()`.
- `getIdentity()` (`src/lib/auth/session.ts`) → `{email,isAdmin,isSuper,clientId}`; client resolution `getClients` + `resolveSelectedClient` (`src/lib/client-selection.ts`) as `customers/page.tsx:109-115`.
- Sheet shell: `src/components/customers/customer-sheet.tsx:72-75`. `Button`/`buttonVariants`: `src/components/ui/button.tsx`. Form recipe: `docs/design-system/trace-design-system.md:191-213`. No ui/input|select|toast exist — hand-roll per recipe; `@base-ui/react ^1.6` `Combobox` is fine to introduce (docs in `node_modules/@base-ui/react/docs/react/components/combobox.md`, "Async search (single)").
- Money: `toMinorUnits` (`src/lib/meta/money.ts`), `formatINR`. Dates: `istToday()` (`src/lib/queries/overview.ts:193`), `DAY_RE` (`src/lib/range.ts:88`), native `type="date"` + `scheme-dark` (`date-range-picker.tsx:302-336`).
- Search idiom: `sanitizeSearch` + `.or(...)` (`src/lib/queries/customers.ts:176-216`) — export it; drop the cohort filter; add `phone_norm`.
- Tests: `tests/app-users-rls.test.ts` (created[] + afterAll cleanup, `/row-level security/i`), `tests/helpers/supabase.ts`, `tests/metric-helpers.test.ts` (RPC parity pattern). `tests/l2-rls.test.ts` anon-denial must stay green.


# Record external payment — implementation plan (2026-09-21)

Companion to `docs/superpowers/specs/2026-09-21-record-external-payment-design.md`. Executed 2026-09-21; the migration SQL below is the file that was applied (`supabase/migrations/20260921090000_*.sql`). Deviations from this plan are recorded in `docs/STATUS.md`.

## Implementation steps (TDD; each step red → green before the next)

### Step 0 — Pre-flight (read-only via Supabase MCP) and docs skeleton
- `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('customers','external_payments') and grantee in ('anon','authenticated')` (decides whether the REVOKEs below are real or no-ops).
- `select status, count(*) from external_payments group by 1` → must be only `captured`.
- `select policyname, cmd from pg_policies where tablename in ('customers','external_payments')` → only the two read policies.
- Save the design as `docs/superpowers/specs/2026-09-21-record-external-payment-design.md` and this plan as `docs/superpowers/plans/2026-09-21-record-external-payment-implementation.md` (content = this file, trimmed); commit.

### Step 1 — Pure TS modules + tests (no DB)
Create `src/lib/payments/`:
- `normalize.ts` — `normalizeEmail`, `normalizePhone` byte-for-byte Trace's. Export `NORMALIZE_CASES` fixture from the test for Step 2 parity.
- `amount.ts` — `parseRupeesToPaise(input): number | null`: strip `₹`, spaces, commas; require `/^\d+(\.\d{1,2})?$/`; `toMinorUnits(clean,'INR')`; null for 0/negative/>2 decimals.
- `methods.ts` — `PAYMENT_METHODS`: `gpay` GPay, `phonepe` PhonePe, `upi` UPI (other), `bank_transfer` Bank transfer, `cash` Cash, `cheque` Cheque, `other` Other; each with `referenceHint` (UPI family → "12-digit UTR / UPI transaction ID", bank → "UTR or reference no.", cheque → "Cheque number", else "Optional").
- `record-schema.ts` — one zod 4 schema shared by client + server: `customerMode 'existing'|'new'`, `customerId uuid?`, `newName (1–120)`, `newEmail`/`newPhone` (refine: ≥1 normalises non-null when new), `amount` (string → paise), `paidDay` (`DAY_RE`, ≤ today via `schemaFor(today)`), `method` enum, `reference ≤100`, `productName ≤200`, `note ≤300`, `idempotencyKey uuid`, `confirmDuplicate boolean`. `FieldErrors` + `flatten()` (one message per field).
- Edit `src/lib/payment-origin.ts`: add `phonepe`, `cheque`, `other` to `METHOD_NAMES`.
Tests: `tests/payments-normalize.test.ts`, `tests/payments-amount.test.ts`, `tests/payments-record-schema.test.ts`; extend `tests/payment-origin.test.ts`.

### Step 2 — Migrations (apply via MCP `apply_migration`), then live tests
`supabase/migrations/20260921090000_manual_payments_record_and_void.sql` — full SQL:

```sql
-- Record-payment flow: hand-recorded off-platform upsells from the dashboard.
-- Supersedes the "dashboard is read-only against customers/external_payments"
-- claim in 20260816090000's header. Trace still owns every SYNCED row. The
-- dashboard writes exactly two kinds of row, under the caller's own RLS through
-- security-invoker functions: source='manual' external_payments, and the
-- L2-only customers those payments need. Corrections are void-only. DDL on
-- Trace-owned tables — Sharan's sign-off 2026-09-21, ADR 004.

-- 1. Identity normalisation, mirrored from Trace's identity.service.ts. Pure and
--    RPC-callable so src/lib/payments/normalize.ts is parity-tested against them.
create or replace function public.identity_normalize_email(value text)
returns text language sql immutable parallel safe set search_path = public as $$
  select case
    when value is null then null
    when length(lower(btrim(value))) <= 3 then null
    when position('@' in value) = 0 then null
    else lower(btrim(value)) end;
$$;
create or replace function public.identity_normalize_phone(value text)
returns text language sql immutable parallel safe set search_path = public as $$
  select case
    when value is null then null
    when length(regexp_replace(value, '[^0-9]', '', 'g')) < 10 then null
    else right(regexp_replace(value, '[^0-9]', '', 'g'), 10) end;
$$;

-- 2. Privileges. Supabase default privileges hand table-level ALL to anon and
--    authenticated, so column grants only mean something after a revoke.
--    external_order_id is deliberately NOT insertable (structural, not policy).
revoke insert, update, delete on public.external_payments from anon, authenticated;
revoke insert, update, delete on public.customers          from anon, authenticated;
grant insert (client_id, customer_id, source, external_payment_id, status, amount,
              currency, customer_name, customer_email, customer_phone, email_norm,
              phone_norm, description, raw_payload, paid_at, product_name)
  on public.external_payments to authenticated;
grant update (status, raw_payload) on public.external_payments to authenticated;
grant delete on public.external_payments to authenticated;   -- bounded by the test-only policy below
grant insert (client_id, email_norm, phone_norm, name, first_paid_at) on public.customers to authenticated;
grant delete on public.customers to authenticated;           -- bounded by the test-only policy below

-- 3. Policies. Same two tenant cases as every read policy; extra predicates pin
--    the SHAPE of a dashboard-written row so a direct PostgREST insert is exactly
--    as constrained as the RPC path.
create policy "dashboard_insert_customers" on public.customers for insert to authenticated
  with check (
    ((auth.jwt() ->> 'is_admin')::boolean is true or client_id::text = auth.jwt() ->> 'client_id')
    and l1_payment_id is null
    and email_norm is not distinct from public.identity_normalize_email(email_norm)
    and phone_norm is not distinct from public.identity_normalize_phone(phone_norm));

create policy "dashboard_insert_external_payments" on public.external_payments for insert to authenticated
  with check (
    ((auth.jwt() ->> 'is_admin')::boolean is true or client_id::text = auth.jwt() ->> 'client_id')
    and source = 'manual' and status = 'captured'
    and external_order_id is null
    and external_payment_id like 'manual\_%'
    and amount > 0 and currency = 'INR'
    and customer_id is not null
    and (raw_payload ->> 'manual_entry')::boolean is true
    -- audit trail cannot be forged; the test-only delete policy keys off it
    and raw_payload ->> 'recorded_by' = lower(auth.jwt() ->> 'email'));

create policy "dashboard_void_external_payments" on public.external_payments for update to authenticated
  using  ((auth.jwt() ->> 'is_admin')::boolean is true and source = 'manual')
  with check ((auth.jwt() ->> 'is_admin')::boolean is true and source = 'manual'
              and status in ('captured', 'voided'));

-- Test hygiene only. Only the two *@trace.local test identities can produce
-- rows/customers carrying a trace.local address (insert policy forces
-- recorded_by = caller's email; test customers are created with such emails).
create policy "dashboard_delete_test_manual_external_payments" on public.external_payments for delete to authenticated
  using ((auth.jwt() ->> 'is_admin')::boolean is true and source = 'manual'
         and raw_payload ->> 'recorded_by' like '%@trace.local');
create policy "dashboard_delete_test_orphan_customers" on public.customers for delete to authenticated
  using ((auth.jwt() ->> 'is_admin')::boolean is true
         and l1_payment_id is null
         and email_norm like '%@trace.local'
         and not exists (select 1 from public.payments p where p.customer_id = customers.id)
         and not exists (select 1 from public.external_payments ep where ep.customer_id = customers.id));

-- 4. record_manual_payment — one call, one transaction. Soft outcomes
--    (duplicate, conflict) are RETURNED before any write; hard failures raise
--    TR* SQLSTATEs with a {"field": ...} detail the action maps to a field.
create or replace function public.record_manual_payment(
  p_client_id uuid, p_amount_paise integer, p_paid_day date, p_method text,
  p_idempotency_key uuid,
  p_customer_id uuid default null, p_new_name text default null,
  p_new_email text default null, p_new_phone text default null,
  p_reference text default null, p_product_name text default null,
  p_note text default null, p_confirm_duplicate boolean default false
) returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_recorded_by text := lower(auth.jwt() ->> 'email');
  v_email text; v_phone text;
  v_by_email customers%rowtype; v_by_phone customers%rowtype; v_customer customers%rowtype;
  v_created boolean := false; v_paid_at timestamptz; v_ext_id text;
  v_existing external_payments%rowtype; v_dup record; v_payment_id uuid; v_method_name text;
begin
  if coalesce(v_recorded_by, '') = '' then raise exception 'Not signed in' using errcode = 'TRVAL'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Amount must be more than zero' using errcode = 'TRVAL', detail = '{"field":"amount"}'; end if;
  if p_paid_day is null or p_paid_day > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Date received cannot be in the future' using errcode = 'TRVAL', detail = '{"field":"paidDay"}'; end if;
  if p_method is null or p_method not in ('gpay','phonepe','upi','bank_transfer','cash','cheque','other') then
    raise exception 'Choose a payment method' using errcode = 'TRVAL', detail = '{"field":"method"}'; end if;
  if length(coalesce(p_reference,'')) > 100 then raise exception 'Reference is too long' using errcode='TRVAL', detail='{"field":"reference"}'; end if;
  if length(coalesce(p_product_name,'')) > 200 then raise exception 'Product name is too long' using errcode='TRVAL', detail='{"field":"productName"}'; end if;
  if length(coalesce(p_note,'')) > 300 then raise exception 'Note is too long' using errcode='TRVAL', detail='{"field":"note"}'; end if;
  if p_idempotency_key is null then raise exception 'Missing idempotency key' using errcode = 'TRVAL'; end if;

  v_ext_id  := 'manual_' || p_idempotency_key::text;
  v_paid_at := (p_paid_day + time '12:00') at time zone 'Asia/Kolkata';  -- only the IST day is known

  -- Retry-safe replay: same key already landed -> report it, write nothing.
  select * into v_existing from external_payments
   where client_id = p_client_id and source = 'manual' and external_payment_id = v_ext_id;
  if found then
    return jsonb_build_object('outcome','recorded','replayed',true,'payment_id',v_existing.id,
      'customer_id',v_existing.customer_id,'customer_name',v_existing.customer_name,
      'amount_paise',v_existing.amount,'created_customer',false);
  end if;

  -- Resolve the customer.
  if p_customer_id is not null then
    select * into v_customer from customers where id = p_customer_id and client_id = p_client_id;
    if not found then raise exception 'Customer not found' using errcode = 'TRNOC'; end if;  -- RLS: foreign == missing
  else
    v_email := identity_normalize_email(p_new_email);
    v_phone := identity_normalize_phone(p_new_phone);
    if v_email is null and v_phone is null then
      raise exception 'Enter a valid email or a 10-digit phone number' using errcode='TRVAL', detail='{"field":"newEmail"}'; end if;
    if nullif(btrim(coalesce(p_new_name,'')),'') is null then
      raise exception 'Enter the customer''s name' using errcode='TRVAL', detail='{"field":"newName"}'; end if;
    if v_email is not null then select * into v_by_email from customers where client_id = p_client_id and email_norm = v_email; end if;
    if v_phone is not null then select * into v_by_phone from customers where client_id = p_client_id and phone_norm = v_phone; end if;
    if v_by_email.id is not null and v_by_phone.id is not null and v_by_email.id <> v_by_phone.id then
      -- Trace's sync would merge these; the dashboard must not.
      return jsonb_build_object('outcome','conflict',
        'email_customer', jsonb_build_object('id',v_by_email.id,'name',v_by_email.name,'email_norm',v_by_email.email_norm,'phone_norm',v_by_email.phone_norm),
        'phone_customer', jsonb_build_object('id',v_by_phone.id,'name',v_by_phone.name,'email_norm',v_by_phone.email_norm,'phone_norm',v_by_phone.phone_norm));
    end if;
    if v_by_email.id is not null then v_customer := v_by_email; elsif v_by_phone.id is not null then v_customer := v_by_phone; end if;
  end if;

  -- Same-day duplicate guard (the Ritu case). Any source, same customer, same
  -- IST day, same amount. Runs before any write so the soft return is clean.
  if v_customer.id is not null and not p_confirm_duplicate then
    select ep.id, ep.amount, ep.paid_at, ep.source, ep.product_name, nullif(ep.raw_payload->>'method','') as method
      into v_dup from external_payments ep
     where ep.client_id = p_client_id and ep.customer_id = v_customer.id and ep.status = 'captured'
       and ep.amount = p_amount_paise
       and (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date = p_paid_day
     order by ep.paid_at limit 1;
    if found then
      return jsonb_build_object('outcome','duplicate','match', jsonb_build_object(
        'id',v_dup.id,'amount_paise',v_dup.amount,'paid_at',v_dup.paid_at,'source',v_dup.source,
        'product_name',v_dup.product_name,'payment_method',v_dup.method,
        'customer_id',v_customer.id,'customer_name',v_customer.name));
    end if;
  end if;

  -- Unknown buyer: create the L2-only customer (first_paid_at = this payment;
  -- l1_payment_id stays null -> Unattributed). Adopt Trace's row on a race.
  if v_customer.id is null then
    begin
      insert into customers (client_id, email_norm, phone_norm, name, first_paid_at)
      values (p_client_id, v_email, v_phone, btrim(p_new_name), v_paid_at) returning * into v_customer;
      v_created := true;
    exception when unique_violation then
      select * into v_customer from customers where client_id = p_client_id
        and ((v_email is not null and email_norm = v_email) or (v_phone is not null and phone_norm = v_phone))
       order by created_at limit 1;
      if v_customer.id is null then raise; end if;
    end;
  end if;

  v_method_name := case p_method when 'gpay' then 'GPay' when 'phonepe' then 'PhonePe' when 'upi' then 'UPI'
    when 'bank_transfer' then 'bank transfer' when 'cash' then 'cash' when 'cheque' then 'cheque' else 'another method' end;

  insert into external_payments (client_id, customer_id, source, external_payment_id, status, amount, currency,
    customer_name, customer_email, customer_phone, email_norm, phone_norm, description, raw_payload, paid_at, product_name)
  values (p_client_id, v_customer.id, 'manual', v_ext_id, 'captured', p_amount_paise, 'INR',
    coalesce(v_customer.name,''), coalesce(v_customer.email_norm,''), coalesce(v_customer.phone_norm,''),
    v_customer.email_norm, v_customer.phone_norm,
    format('Paid via %s directly to the coach; recorded by hand by %s', v_method_name, v_recorded_by),
    jsonb_strip_nulls(jsonb_build_object('manual_entry',true,'method',p_method,
      'reference',nullif(btrim(coalesce(p_reference,'')),''),'note',nullif(btrim(coalesce(p_note,'')),''),
      'recorded_by',v_recorded_by,'recorded_at',now(),'idempotency_key',p_idempotency_key,
      'paid_day_ist',p_paid_day,'time_approximate',true,
      'confirmed_duplicate', case when p_confirm_duplicate then true else null end)),
    v_paid_at, nullif(btrim(coalesce(p_product_name,'')),''))
  returning id into v_payment_id;

  return jsonb_build_object('outcome','recorded','replayed',false,'payment_id',v_payment_id,
    'customer_id',v_customer.id,'customer_name',v_customer.name,'amount_paise',p_amount_paise,'created_customer',v_created);
end; $$;

-- 5. void_manual_payment — the only correction. A non-admin's UPDATE matches no
--    policy row -> not found -> TRNOV.
create or replace function public.void_manual_payment(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare v_by text := lower(auth.jwt() ->> 'email'); v_row external_payments%rowtype;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null or length(p_reason) > 300 then
    raise exception 'Give a short reason for voiding' using errcode='TRVAL', detail='{"field":"reason"}'; end if;
  update external_payments set status = 'voided',
         raw_payload = raw_payload || jsonb_build_object('voided_by',v_by,'voided_at',now(),'void_reason',btrim(p_reason))
   where id = p_id and source = 'manual' and status = 'captured' returning * into v_row;
  if not found then raise exception 'Only a captured hand-recorded payment can be voided' using errcode = 'TRNOV'; end if;
  return jsonb_build_object('payment_id',v_row.id,'customer_id',v_row.customer_id,'amount_paise',v_row.amount,'voided_by',v_by);
end; $$;

-- 6. Execute grants — same doctrine as customers_* / overview_*.
revoke execute on function public.identity_normalize_email(text) from public, anon;
revoke execute on function public.identity_normalize_phone(text) from public, anon;
revoke execute on function public.record_manual_payment(uuid,integer,date,text,uuid,uuid,text,text,text,text,text,text,boolean) from public, anon;
revoke execute on function public.void_manual_payment(uuid,text) from public, anon;
grant execute on function public.identity_normalize_email(text) to authenticated;
grant execute on function public.identity_normalize_phone(text) to authenticated;
grant execute on function public.record_manual_payment(uuid,integer,date,text,uuid,uuid,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.void_manual_payment(uuid,text) to authenticated;
```

`supabase/migrations/20260921090100_external_payments_status_check.sql` (separate so it can be deferred; Trace's pull filters to `captured` before writing — verified `razorpay-pull.service.ts:128`):
```sql
alter table public.external_payments add constraint external_payments_status_check
  check (status in ('captured','voided')) not valid;
alter table public.external_payments validate constraint external_payments_status_check;
```

Live tests (tenant for the client identity = its own `client_id` decoded from the JWT, never Love School):
- `tests/manual-payments-rls.test.ts` — anon: both RPCs error; `l2-rls` anon-denial still green. Client identity: records for own client (`recorded`); foreign customer id → `TRNOC`; new-customer for foreign client → `/row-level security/i`; direct insert with `status:'paid'` → RLS error; direct insert naming `external_order_id` → `42501` (column privilege); `recorded_by` ≠ own email → RLS error; `void` on an admin row → `TRNOV`, still `captured`. Admin: records; voids → `voided`, `voided_by/void_reason` present, absent from `customer_payments_unified` and `overview_day_payments`; second void → `TRNOV`. Cleanup in `afterAll`: delete payments by id, then orphan customers; assert both gone.
- `tests/manual-payments-rpc.test.ts` — SQL/TS normalisation parity over `NORMALIZE_CASES`; create path (`created_customer:true`, `first_paid_at` = `paid_at` = `min(paid_at)` in `customer_payments_unified`, `v_customers_attributed` row with `ad_key null`, `purchase_count 1`, `acquired_day_ist` = the day); normalisation match (`" RLS-TEST…@TRACE.LOCAL "` + `+91` phone → same customer); duplicate (same/day/amount → `duplicate` with `match.id`; `p_confirm_duplicate` → recorded with `confirmed_duplicate:true`; different amount → no duplicate); conflict (A email-only, B phone-only, then A's email + B's phone → `conflict`, no row written); idempotency (same key twice → `replayed:true`, one row); reconciliation (row appears in `getDayPayments` and `overview_revenue_daily` grows by `amount`, `attemptStable`; after void both drop back); validation (future day → `TRVAL` with `details` containing `paidDay`; `venmo` → `TRVAL`). Confirm in the first live test that PostgREST surfaces `error.code='TRVAL'` and `error.details` (avoid `PT`-prefixed codes).

### Step 3 — Query layer
Create `src/lib/queries/manual-payments.ts`: `searchCustomersForRecord(supabase, clientId, q, limit=8)` (from `customers`, `.or(name/email_norm/phone_norm ilike)`, no range filter), `findCustomerByKeys(supabase, clientId, email, phone)` (live duplicate-customer warning in create mode), `getCustomerBrief(supabase, id)`, `getLastManualProduct(supabase, clientId)` (latest manual `product_name`, fallback `"Coaching program"`), `getVoidedManualPayments(supabase, customerId)`; types `RecordOutcome`, `DuplicateMatch`, `ConflictPair`.
Edit `src/lib/queries/customers.ts`: export `sanitizeSearch`; `TimelineEntry` gains `row_id`, `status:'captured'|'voided'`, `voided_by`, `void_reason`; `getCustomerDetail` selects `row_id`, merges voided manual rows, sorts by `paid_at`. Extend `tests/customers-page.test.ts` for the voided row.

### Step 4 — Server actions
Create `src/app/(dashboard)/customers/actions.ts` (`"use server"`), modelled on `settings/users/actions.ts`:
- `RecordState = { key?, ok?, recorded?: {paymentId, customerId, customerName, amountPaise, createdCustomer}, duplicate?, conflict?, error?, fieldErrors? }` (`key` echoes the idempotency key so the component matches state to submission).
- `recordManualPayment(prev, formData)`: `schemaFor(istToday()).safeParse` → `fieldErrors`; `getIdentity()`; resolve client **from the cookie** via `getClients` + `resolveSelectedClient` (never from the form); `rpc("record_manual_payment", …)`; map `TRVAL` → `fieldErrors[details.field]`, `TRNOC` → "That customer is no longer available", `42501`/RLS → "You can't record payments for this client", `23505` → replay once; on `recorded` → `revalidatePath("/", "layout")`.
- `voidManualPayment(prev, formData)`: zod `{id uuid, reason 1–300}` → `rpc("void_manual_payment")`; `TRNOV` → message; revalidate.
- `searchCustomers(clientId, q)`: read-only action for the combobox (cookie-authenticated, RLS-scoped).

### Step 5 — UI
- `src/components/customers/customer-combobox.tsx` (client): Base UI `Combobox.Root` async-single pattern (`items`, `filter={null}`, 250 ms debounce + `startTransition` + sequence counter; `Combobox.Status` "Searching…/No matches"). Synthetic `Create "<query>" as new customer` row when no exact match → create mode reveals Name/Email/Phone; on blur, `findCustomerByKeys` → "Looks like <name> already exists — use them instead" (button selects them). Emits hidden inputs `customerMode/customerId/newName/newEmail/newPhone`.
- `src/components/customers/record-payment-sheet.tsx` (client): `Dialog` shell from `customer-sheet.tsx:72-75`; props `{clientName, today, defaultProduct, prefill: CustomerBrief|null, returnToCustomerId}`; `useActionState(recordManualPayment)`. Fields in order: Customer, Amount (`type="text" inputMode="decimal"`, `aria-hidden` ₹ prefix), Date received (`max={today}`, default today, `scheme-dark`), Method (native `<select>`, hint swaps per method), Reference, Product, Note. `noValidate`; validate on **submit** with the shared schema; error summary `role="alert"` with focus + field links; values preserved. Sticky fields are controlled state (React 19 resets uncontrolled inputs after a successful action). Idempotency key `useState(() => crypto.randomUUID())` in a hidden input, re-minted on "Record another". Panels: pending ("Saving…" + `Loader2`) → **recorded** (`aria-live="polite"`: "Payment recorded — ₹9,724 from Hetal"; Done / Record another) | **duplicate** (match card: name, `formatINR`, IST day, `paymentOrigin` label; "Record anyway" sets `confirmDuplicate` and resubmits same key / Cancel) | **conflict** ("Two customers match: X (email) and Y (phone)"; Use X / Use Y). `close()` deletes `record` and, if `returnToCustomerId`, restores `customer=<id>` (the two sheets never stack).
- `src/components/customers/void-payment-form.tsx` (client): inline reason input + "Void" via `useActionState(voidManualPayment)`.
- Edit `customer-sheet.tsx`: props `canRecord`, `canVoid`; header `Link` to `?record=<customer_id>` (replacing `customer`); voided rows `line-through text-slate-500` + "Voided by <email> · <reason>"; manual captured rows with `canVoid` get a "Void" toggle.
- Edit `customers/page.tsx`: `record` search param; `identity = await getIdentity()`; `canRecord = identity.isAdmin || identity.clientId === selected.id`; `canVoid = identity.isAdmin`; parse `record` (`"1"` → blank, uuid → `getCustomerBrief`, discard if `client_id !== selected.id`); `defaultProduct`; hoist a `<CustomersHeader>` so both tabs render the "Record payment" button (`buttonVariants({size:"lg"})` Link) next to `<DateRangePicker>` when `canRecord`; mount `<RecordPaymentSheet>` in both branches when `record` is present.

### Step 6 — Docs
- `docs/adr/004-dashboard-writes-to-l2-tables.md` (why RPC under RLS, why not service role, why not merge, void-only, the `@trace.local` test-hygiene policies).
- `docs/STATUS.md`: replace the "add-transaction flow is still owed" bullet; note the status CHECK; L2-only customers count as new customers / ladder ordinal 1 / excluded from split-mode L2 (no L1 in window); future sessions **void, never delete**.
- `.claude/rules/auth-security.md` (write-policy list + column-grant shape), `.claude/rules/data-model.md` (add `customers`/`external_payments` sections, `status ∈ {captured, voided}`, `manual_<uuid>` convention), `CLAUDE.md` "On writing to Trace's tables" (L2 tables now carry deliberate write policies per ADR 004; the core five still never), `docs/design-system/trace-design-system.md:298,317` ("no modal *pages*; URL-driven right sheets are the drill-down/entry idiom").
- Also save the research memo to `docs/superpowers/research/2026-09-21-offline-payment-recording.md`.

## Verification
1. `npm run typecheck`; `npm test` — full suite green (note the count in STATUS). `l2-rls`, `customers-rpcs`, `overview-day-drilldown`, `customers-page` unchanged and green.
2. Supabase advisors (security): no `function_search_path_mutable` for the four new functions; no new RLS warnings.
3. `/run` the app as admin: `/customers?record=1` → pick a Love School customer → record ₹1 for today → success panel → "Record another" keeps amount/date/method/product with a new key → Done. Open that customer's sheet → "GPay · recorded by hand" → Void with reason → struck-through. Overview day drill-down for today shows the row, then not after void. Screenshots.
4. Duplicate path: pick Ritu, enter ₹9,724.20 on 2026-09-13 → duplicate panel names the Razorpay "Payment link" row → Cancel. Create path with an existing email → inline "already exists" warning. Conflict path → conflict panel.
5. Button hidden when `selected.id !== identity.clientId` for a non-admin (asserted via RLS tests; UI gate by inspection).
6. Keyboard-only walk: combobox arrows/Enter, error summary receives focus, Esc closes, success panel announced.
7. Clean the ₹1 rows with **void** (recorded by a real email, so the test delete policy correctly does not apply).

## Risks (accepted for v1, recorded in ADR 004)
- **L2-only customer later buys L1:** Trace links the L1 to our row and `recompute_client_l1` moves `first_paid_at` to the later L1 date → cohort day shifts; `first_paid_at != min(paid_at)` for that person (would trip `customers-rpcs.test.ts`'s invariant only if they land in its 25-newest sample). Fix if it bites: `least(first_paid_at, min(external paid_at))` in `v_customers_attributed`. Trace may also merge our customer into another (it repoints `external_payments.customer_id` first — no orphaned payment).
- **Status CHECK on a Trace-owned table:** safe for today's sync; if Trace ever writes `refunded`, its sync fails loudly — note in Trace's STATUS.
- **Test-hygiene delete policies** exist in prod, scoped to `@trace.local` identities/emails only.
- **PostgREST custom SQLSTATEs** — verify `error.code/details` surfacing in the first live test.
- **Combobox via server action** = POST per debounced keystroke; sequence guard handles ordering; switch to a GET route if latency shows.

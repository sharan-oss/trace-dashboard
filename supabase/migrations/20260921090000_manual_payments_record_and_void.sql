-- ---------------------------------------------------------------------------
-- Record-payment flow: hand-recorded off-platform upsells from the dashboard
-- (2026-09-21). Design: docs/superpowers/specs/2026-09-21-record-external-payment-design.md
-- Decision record: docs/adr/004-dashboard-writes-to-l2-tables.md
--
-- Supersedes the "this dashboard is read-only against customers /
-- external_payments" claim in 20260816090000's header and 20260810090000's.
-- Trace still owns every SYNCED row (its service-role sync is untouched). The
-- dashboard now writes exactly two kinds of row, under the caller's own RLS
-- through security-invoker functions:
--   * source='manual' external_payments (GPay / bank / cash straight to the coach)
--   * the L2-only customers those payments need when the buyer never came
--     through Trace's checkout (Trace's sync would drop such a payment; this is
--     the one deliberate divergence, and it leaves l1_payment_id null so the
--     person shows as Unattributed).
-- Corrections are void-only (status='voided'); nothing application-facing
-- deletes. DDL on Trace-owned tables — Sharan's sign-off 2026-09-21.
-- ---------------------------------------------------------------------------

-- 1. Identity normalisation, mirrored byte-for-byte from Trace's
--    src/modules/sync/identity.service.ts. Pure and RPC-callable so the TS
--    twin in src/lib/payments/normalize.ts is parity-tested against them.
create or replace function public.identity_normalize_email(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when value is null then null
    when length(lower(btrim(value))) <= 3 then null
    when position('@' in value) = 0 then null
    else lower(btrim(value))
  end;
$$;

create or replace function public.identity_normalize_phone(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when value is null then null
    when length(regexp_replace(value, '[^0-9]', '', 'g')) < 10 then null
    else right(regexp_replace(value, '[^0-9]', '', 'g'), 10)
  end;
$$;

-- 2. Privileges. Supabase's default privileges hand table-level ALL to anon
--    and authenticated (verified 2026-09-21: INSERT/UPDATE/DELETE/TRUNCATE/
--    REFERENCES/TRIGGER on both tables). RLS guards the row-level verbs, but
--    TRUNCATE is not subject to RLS at all, and column grants only mean
--    something once the table-level grant is gone. So: revoke everything but
--    SELECT, then grant back exactly the columns the flow writes.
--    external_order_id is deliberately NOT insertable: every L2 aggregate
--    anti-joins it against payments.order_id, so a manual row carrying a
--    value there would vanish from every number. Structural, not policy.
revoke insert, update, delete, truncate, references, trigger
  on public.external_payments from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.customers from anon, authenticated;

grant insert (client_id, customer_id, source, external_payment_id, status, amount,
              currency, customer_name, customer_email, customer_phone, email_norm,
              phone_norm, description, raw_payload, paid_at, product_name)
  on public.external_payments to authenticated;
grant update (status, raw_payload) on public.external_payments to authenticated;
-- delete is bounded to test fixtures by policy (below); prod rows are voided.
grant delete on public.external_payments to authenticated;

grant insert (client_id, email_norm, phone_norm, name, first_paid_at)
  on public.customers to authenticated;
grant delete on public.customers to authenticated;

-- 3. Policies. The tenant rule is the same two cases as every read policy;
--    the extra predicates pin the SHAPE of a dashboard-written row so a direct
--    PostgREST insert is exactly as constrained as the RPC path.
create policy "dashboard_insert_customers"
  on public.customers
  for insert
  to authenticated
  with check (
    ((auth.jwt() ->> 'is_admin')::boolean is true
      or client_id::text = auth.jwt() ->> 'client_id')
    and l1_payment_id is null
    and email_norm is not distinct from public.identity_normalize_email(email_norm)
    and phone_norm is not distinct from public.identity_normalize_phone(phone_norm)
  );

create policy "dashboard_insert_external_payments"
  on public.external_payments
  for insert
  to authenticated
  with check (
    ((auth.jwt() ->> 'is_admin')::boolean is true
      or client_id::text = auth.jwt() ->> 'client_id')
    and source = 'manual'
    and status = 'captured'
    and external_order_id is null
    and external_payment_id like 'manual\_%'
    and amount > 0
    and currency = 'INR'
    and customer_id is not null
    and (raw_payload ->> 'manual_entry')::boolean is true
    -- Forced to the caller's own address: the audit trail cannot be forged,
    -- and the test-only delete policy below keys off it.
    and raw_payload ->> 'recorded_by' = lower(auth.jwt() ->> 'email')
  );

create policy "dashboard_void_external_payments"
  on public.external_payments
  for update
  to authenticated
  using ((auth.jwt() ->> 'is_admin')::boolean is true and source = 'manual')
  with check (
    (auth.jwt() ->> 'is_admin')::boolean is true
    and source = 'manual'
    and status in ('captured', 'voided')
  );

-- Test hygiene only. The suite signs in as dashboard-{admin,client}-test@trace.local;
-- the insert policy forces recorded_by to the caller's email, so only those
-- identities can ever produce a row carrying a trace.local address, and the
-- fixture customers they create use trace.local emails too. No Google account
-- can hold that domain.
create policy "dashboard_delete_test_manual_external_payments"
  on public.external_payments
  for delete
  to authenticated
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    and source = 'manual'
    and raw_payload ->> 'recorded_by' like '%@trace.local'
  );

create policy "dashboard_delete_test_orphan_customers"
  on public.customers
  for delete
  to authenticated
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    and l1_payment_id is null
    and email_norm like '%@trace.local'
    and not exists (select 1 from public.payments p where p.customer_id = customers.id)
    and not exists (select 1 from public.external_payments ep where ep.customer_id = customers.id)
  );

-- 4. record_manual_payment — one call, one transaction: resolve or create the
--    customer, guard against a same-day duplicate, insert the payment.
--    security invoker: every read and write inside runs under the caller's
--    RLS, so a client user cannot reach another tenant's customer (it simply
--    is not found). Soft outcomes (duplicate, conflict) are RETURNED, never
--    raised — both are decided before any write, so nothing needs rolling
--    back. Hard failures raise with a TR* SQLSTATE and a {"field": ...}
--    detail the server action maps onto the form.
create or replace function public.record_manual_payment(
  p_client_id         uuid,
  p_amount_paise      integer,
  p_paid_day          date,
  p_method            text,
  p_idempotency_key   uuid,
  p_customer_id       uuid    default null,
  p_new_name          text    default null,
  p_new_email         text    default null,
  p_new_phone         text    default null,
  p_reference         text    default null,
  p_product_name      text    default null,
  p_note              text    default null,
  p_confirm_duplicate boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_recorded_by text := lower(auth.jwt() ->> 'email');
  v_email       text;
  v_phone       text;
  v_by_email    customers%rowtype;
  v_by_phone    customers%rowtype;
  v_customer    customers%rowtype;
  v_created     boolean := false;
  v_paid_at     timestamptz;
  v_ext_id      text;
  v_existing    external_payments%rowtype;
  v_dup         record;
  v_payment_id  uuid;
  v_method_name text;
begin
  if coalesce(v_recorded_by, '') = '' then
    raise exception 'Not signed in' using errcode = 'TRVAL';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Amount must be more than zero'
      using errcode = 'TRVAL', detail = '{"field":"amount"}';
  end if;
  if p_paid_day is null or p_paid_day > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Date received cannot be in the future'
      using errcode = 'TRVAL', detail = '{"field":"paidDay"}';
  end if;
  if p_method is null or p_method not in
     ('gpay', 'phonepe', 'upi', 'bank_transfer', 'cash', 'cheque', 'other') then
    raise exception 'Choose a payment method'
      using errcode = 'TRVAL', detail = '{"field":"method"}';
  end if;
  if length(coalesce(p_reference, '')) > 100 then
    raise exception 'Reference is too long'
      using errcode = 'TRVAL', detail = '{"field":"reference"}';
  end if;
  if length(coalesce(p_product_name, '')) > 200 then
    raise exception 'Product name is too long'
      using errcode = 'TRVAL', detail = '{"field":"productName"}';
  end if;
  if length(coalesce(p_note, '')) > 300 then
    raise exception 'Note is too long'
      using errcode = 'TRVAL', detail = '{"field":"note"}';
  end if;
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key' using errcode = 'TRVAL';
  end if;

  v_ext_id  := 'manual_' || p_idempotency_key::text;
  -- Only the IST day is known; noon IST keeps every day bucket honest.
  v_paid_at := (p_paid_day + time '12:00') at time zone 'Asia/Kolkata';

  -- Retry-safe replay: the same key already landed -> report it, write nothing.
  select * into v_existing
    from external_payments
   where client_id = p_client_id
     and source = 'manual'
     and external_payment_id = v_ext_id;
  if found then
    return jsonb_build_object(
      'outcome', 'recorded', 'replayed', true,
      'payment_id', v_existing.id, 'customer_id', v_existing.customer_id,
      'customer_name', v_existing.customer_name,
      'amount_paise', v_existing.amount, 'created_customer', false);
  end if;

  -- Resolve the customer.
  if p_customer_id is not null then
    select * into v_customer
      from customers
     where id = p_customer_id and client_id = p_client_id;
    if not found then
      -- Under RLS another tenant's id and a missing id look identical. Good.
      raise exception 'Customer not found' using errcode = 'TRNOC';
    end if;
  else
    v_email := identity_normalize_email(p_new_email);
    v_phone := identity_normalize_phone(p_new_phone);
    if v_email is null and v_phone is null then
      raise exception 'Enter a valid email or a 10-digit phone number'
        using errcode = 'TRVAL', detail = '{"field":"newEmail"}';
    end if;
    if nullif(btrim(coalesce(p_new_name, '')), '') is null then
      raise exception 'Enter the customer''s name'
        using errcode = 'TRVAL', detail = '{"field":"newName"}';
    end if;

    if v_email is not null then
      select * into v_by_email from customers
       where client_id = p_client_id and email_norm = v_email;
    end if;
    if v_phone is not null then
      select * into v_by_phone from customers
       where client_id = p_client_id and phone_norm = v_phone;
    end if;

    -- Trace's sync would merge these two rows; the dashboard must not — that
    -- is a destructive multi-table write across Trace-owned data.
    if v_by_email.id is not null and v_by_phone.id is not null
       and v_by_email.id <> v_by_phone.id then
      return jsonb_build_object(
        'outcome', 'conflict',
        'email_customer', jsonb_build_object(
          'id', v_by_email.id, 'name', v_by_email.name,
          'email_norm', v_by_email.email_norm, 'phone_norm', v_by_email.phone_norm),
        'phone_customer', jsonb_build_object(
          'id', v_by_phone.id, 'name', v_by_phone.name,
          'email_norm', v_by_phone.email_norm, 'phone_norm', v_by_phone.phone_norm));
    end if;

    if v_by_email.id is not null then
      v_customer := v_by_email;
    elsif v_by_phone.id is not null then
      v_customer := v_by_phone;
    end if;
  end if;

  -- Same-day duplicate guard (the "Ritu case": a GPay payment that Razorpay
  -- had already synced as UPI through a payment link). Any source, same
  -- customer, same IST day, same amount. Only an existing customer can have
  -- history, so this runs before any customer is created and the soft return
  -- leaves nothing to roll back.
  if v_customer.id is not null and not p_confirm_duplicate then
    select ep.id, ep.amount, ep.paid_at, ep.source, ep.product_name,
           nullif(ep.raw_payload ->> 'method', '') as method
      into v_dup
      from external_payments ep
     where ep.client_id = p_client_id
       and ep.customer_id = v_customer.id
       and ep.status = 'captured'
       and ep.amount = p_amount_paise
       and (coalesce(ep.paid_at, ep.created_at) at time zone 'Asia/Kolkata')::date = p_paid_day
     order by ep.paid_at
     limit 1;
    if found then
      return jsonb_build_object(
        'outcome', 'duplicate',
        'match', jsonb_build_object(
          'id', v_dup.id, 'amount_paise', v_dup.amount, 'paid_at', v_dup.paid_at,
          'source', v_dup.source, 'product_name', v_dup.product_name,
          'payment_method', v_dup.method,
          'customer_id', v_customer.id, 'customer_name', v_customer.name));
    end if;
  end if;

  -- Unknown buyer: create the L2-only customer. first_paid_at = this payment
  -- so cohort/People ranges include them; l1_payment_id stays null, so they
  -- fall into Unattributed. If Trace's sync creates the same person between
  -- our lookup and insert, adopt its row.
  if v_customer.id is null then
    begin
      insert into customers (client_id, email_norm, phone_norm, name, first_paid_at)
      values (p_client_id, v_email, v_phone, btrim(p_new_name), v_paid_at)
      returning * into v_customer;
      v_created := true;
    exception when unique_violation then
      select * into v_customer from customers
       where client_id = p_client_id
         and ((v_email is not null and email_norm = v_email)
           or (v_phone is not null and phone_norm = v_phone))
       order by created_at
       limit 1;
      if v_customer.id is null then raise; end if;
    end;
  end if;

  v_method_name := case p_method
    when 'gpay' then 'GPay'
    when 'phonepe' then 'PhonePe'
    when 'upi' then 'UPI'
    when 'bank_transfer' then 'bank transfer'
    when 'cash' then 'cash'
    when 'cheque' then 'cheque'
    else 'another method' end;

  insert into external_payments (
    client_id, customer_id, source, external_payment_id, status, amount, currency,
    customer_name, customer_email, customer_phone, email_norm, phone_norm,
    description, raw_payload, paid_at, product_name)
  values (
    p_client_id, v_customer.id, 'manual', v_ext_id, 'captured', p_amount_paise, 'INR',
    coalesce(v_customer.name, ''), coalesce(v_customer.email_norm, ''),
    coalesce(v_customer.phone_norm, ''), v_customer.email_norm, v_customer.phone_norm,
    format('Paid via %s directly to the coach; recorded by hand by %s',
           v_method_name, v_recorded_by),
    jsonb_strip_nulls(jsonb_build_object(
      'manual_entry', true,
      'method', p_method,
      'reference', nullif(btrim(coalesce(p_reference, '')), ''),
      'note', nullif(btrim(coalesce(p_note, '')), ''),
      'recorded_by', v_recorded_by,
      'recorded_at', now(),
      'idempotency_key', p_idempotency_key,
      'paid_day_ist', p_paid_day,
      'time_approximate', true,
      'confirmed_duplicate', case when p_confirm_duplicate then true else null end)),
    v_paid_at,
    nullif(btrim(coalesce(p_product_name, '')), ''))
  returning id into v_payment_id;

  return jsonb_build_object(
    'outcome', 'recorded', 'replayed', false,
    'payment_id', v_payment_id, 'customer_id', v_customer.id,
    'customer_name', v_customer.name, 'amount_paise', p_amount_paise,
    'created_customer', v_created);
end;
$$;

-- 5. void_manual_payment — the only correction. The row stays; every
--    aggregate already filters status='captured', so it leaves every number
--    at once. A non-admin's UPDATE matches no policy row -> not found -> TRNOV.
create or replace function public.void_manual_payment(p_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_by  text := lower(auth.jwt() ->> 'email');
  v_row external_payments%rowtype;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null or length(p_reason) > 300 then
    raise exception 'Give a short reason for voiding'
      using errcode = 'TRVAL', detail = '{"field":"reason"}';
  end if;

  update external_payments
     set status = 'voided',
         raw_payload = raw_payload || jsonb_build_object(
           'voided_by', v_by, 'voided_at', now(), 'void_reason', btrim(p_reason))
   where id = p_id and source = 'manual' and status = 'captured'
  returning * into v_row;

  if not found then
    raise exception 'Only a captured hand-recorded payment can be voided'
      using errcode = 'TRNOV';
  end if;

  return jsonb_build_object(
    'payment_id', v_row.id, 'customer_id', v_row.customer_id,
    'amount_paise', v_row.amount, 'voided_by', v_by);
end;
$$;

-- 6. Execute grants — same doctrine as customers_* / overview_*.
revoke execute on function public.identity_normalize_email(text) from public, anon;
revoke execute on function public.identity_normalize_phone(text) from public, anon;
revoke execute on function public.record_manual_payment(uuid, integer, date, text, uuid, uuid, text, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.void_manual_payment(uuid, text) from public, anon;

grant execute on function public.identity_normalize_email(text) to authenticated;
grant execute on function public.identity_normalize_phone(text) to authenticated;
grant execute on function public.record_manual_payment(uuid, integer, date, text, uuid, uuid, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.void_manual_payment(uuid, text) to authenticated;

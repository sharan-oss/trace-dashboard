-- Phase 2 auth: the app_users allowlist, and the Custom Access Token Hook that
-- turns a verified Google email into the same claims Phase 0's dev stub used to
-- emit. Design: docs/superpowers/specs/2026-08-17-phase-2-auth-design.md
--
-- Sign-in is Google-only. Who you are is decided by your email:
--   1. app_metadata claims          -> emitted unchanged (test + sync identities)
--   2. app_users row 'super_admin'  -> is_admin + is_super
--   3. an @alttredmiinds.com address -> is_admin (no row needed — Google
--      Workspace IS the team directory, so deactivating a mailbox removes
--      dashboard access with no second system to remember)
--   4. app_users row 'client'       -> client_id (their one account)
--   5. anything else                -> no claims, so RLS yields nothing
--
-- The claims emitted are byte-identical to Phase 0's, so every existing RLS
-- policy, view and RPC keeps working untouched.

-- ---------------------------------------------------------------------------
-- The allowlist. Only super admins and client users get rows; team membership
-- is the domain rule, which needs no row at all.
-- ---------------------------------------------------------------------------
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  role text not null check (role in ('super_admin', 'client')),
  client_id uuid references public.clients(id),
  -- The inviter's email. Audit trail, and the scope a team member manages.
  invited_by text not null,
  created_at timestamptz not null default now(),
  constraint app_users_client_needs_account
    check (role <> 'client' or client_id is not null)
);

create index app_users_invited_by_idx on public.app_users (invited_by);

alter table public.app_users enable row level security;

-- Dashboard-owned table, so it carries deliberate write policies rather than
-- being USING-only (see .claude/rules/auth-security.md).
revoke all on public.app_users from anon;
grant select, insert, delete on public.app_users to authenticated;

-- The permission matrix lives here, not in the app: a super admin sees and
-- manages every row, a team member only the rows they added, and a client user
-- matches nothing at all — so the table does not exist as far as they are
-- concerned and the Users page needs no filtering logic of its own.
create policy "app_users_select"
  on public.app_users
  for select
  using (
    (auth.jwt() ->> 'is_super')::boolean is true
    or (
      (auth.jwt() ->> 'is_admin')::boolean is true
      and invited_by = lower(auth.jwt() ->> 'email')
    )
  );

-- invited_by is forced to the inserter's own address, so the audit trail cannot
-- be forged and nobody can pre-assign rows into someone else's scope. Only a
-- super admin may mint another super admin.
create policy "app_users_insert"
  on public.app_users
  for insert
  with check (
    (auth.jwt() ->> 'is_admin')::boolean is true
    and invited_by = lower(auth.jwt() ->> 'email')
    and (
      role = 'client'
      or (auth.jwt() ->> 'is_super')::boolean is true
    )
  );

create policy "app_users_delete"
  on public.app_users
  for delete
  using (
    (auth.jwt() ->> 'is_super')::boolean is true
    or (
      (auth.jwt() ->> 'is_admin')::boolean is true
      and invited_by = lower(auth.jwt() ->> 'email')
    )
  );

-- No update policy on purpose: a role or account change is a remove plus a
-- re-add, which leaves invited_by honest.

-- The hook runs as supabase_auth_admin and must read this table, which RLS
-- would otherwise deny (the documented Supabase RBAC-hook pattern).
grant usage on schema public to supabase_auth_admin;
grant select on public.app_users to supabase_auth_admin;

create policy "app_users_auth_admin_read"
  on public.app_users
  as permissive
  for select
  to supabase_auth_admin
  using (true);

-- ---------------------------------------------------------------------------
-- Hook v2. Replacing the body leaves the Dashboard's Auth Hooks toggle intact.
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  meta jsonb;
  user_email text;
  email_verified boolean;
  allowed public.app_users%rowtype;
begin
  select raw_app_meta_data,
         lower(email),
         email_confirmed_at is not null
    into meta, user_email, email_verified
  from auth.users
  where id = (event->>'user_id')::uuid;

  claims := event->'claims';

  -- Legacy branch, first and unconditional: the two Phase 0 test users and the
  -- ads-sync service identity carry their claims in app_metadata. Real people
  -- never do. This can go once the test suite stops signing in as them.
  if meta ? 'is_admin' or meta ? 'client_id' then
    if meta ? 'is_admin' then
      claims := jsonb_set(claims, '{is_admin}', meta->'is_admin');
    end if;
    if meta ? 'client_id' then
      claims := jsonb_set(claims, '{client_id}', meta->'client_id');
    end if;
    return jsonb_build_object('claims', claims);
  end if;

  -- Everyone else is identified by their email, and only a confirmed one. That
  -- check is what stops someone self-registering an @alttredmiinds.com address
  -- they do not control and inheriting is_admin from the domain rule below:
  -- Supabase's confirmation mail goes to the real mailbox.
  if user_email is null or not email_verified then
    return jsonb_build_object('claims', claims);
  end if;

  select * into allowed from public.app_users where email = user_email;

  if allowed.role = 'super_admin' then
    claims := jsonb_set(claims, '{is_admin}', 'true'::jsonb);
    claims := jsonb_set(claims, '{is_super}', 'true'::jsonb);
  elsif split_part(user_email, '@', 2) = 'alttredmiinds.com' then
    claims := jsonb_set(claims, '{is_admin}', 'true'::jsonb);
  elsif allowed.role = 'client' then
    claims := jsonb_set(claims, '{client_id}', to_jsonb(allowed.client_id::text));
  end if;

  -- No match falls through with claims untouched: no is_admin, no client_id,
  -- so RLS returns nothing anywhere and the app renders /no-access.
  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- Bootstrap: the two super admins, self-invited. Every other row is created
-- through the app.
insert into public.app_users (email, role, invited_by)
values
  ('sharanvkt@gmail.com', 'super_admin', 'sharanvkt@gmail.com'),
  ('sharan@alttredmiinds.com', 'super_admin', 'sharan@alttredmiinds.com')
on conflict (email) do nothing;

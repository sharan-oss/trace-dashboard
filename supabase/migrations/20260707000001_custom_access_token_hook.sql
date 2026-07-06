-- Custom Access Token Hook: injects is_admin/client_id from a user's
-- app_metadata into the JWT's top-level claims at sign-in, so RLS policies
-- (see 20260707000000_dashboard_rls_policies.sql) can read auth.jwt() ->> 'is_admin'
-- / 'client_id' directly. This is the mechanism both Phase 0's test identities
-- and Phase 2's real client login will share — set once, used by both.
--
-- After this migration runs, the hook still needs to be enabled in the
-- Supabase Dashboard: Authentication -> Hooks -> Custom Access Token ->
-- select public.custom_access_token_hook. That step can't be done via SQL.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  meta jsonb;
begin
  select raw_app_meta_data into meta
  from auth.users
  where id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if meta ? 'is_admin' then
    claims := jsonb_set(claims, '{is_admin}', meta->'is_admin');
  end if;

  if meta ? 'client_id' then
    claims := jsonb_set(claims, '{client_id}', meta->'client_id');
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- SECURITY (final review fix): debug_v_payments_attributed_definition() was
-- granted execute to anon and PUBLIC, meaning anyone holding the publishable
-- key -- which ships to the browser -- could call it and read
-- v_payments_attributed's view definition text. The content itself is
-- harmless (no secrets, see migration 20260809140400), but it was
-- unauthenticated production surface that existed purely so a test could
-- structurally verify a join. Locking it to `authenticated` only closes that
-- surface while leaving the structural test (which authenticates) unaffected.
--
-- Also renamed off the `debug_` prefix. This is not a temporary debugging
-- aid to be deleted later -- the join it guards (to v_ad_name_resolution) has
-- zero live rows to exercise it, so this probe is the only thing preventing
-- silent deletion of that join, and it is meant to stay permanently. `_probe`
-- describes what it actually is; `debug_` implied it was disposable.
create or replace function public.v_payments_attributed_definition_probe()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select pg_get_viewdef('public.v_payments_attributed'::regclass);
$$;

-- Revoke both explicitly: Supabase's default privileges on the public schema
-- grant execute to anon at creation time independently of the PUBLIC
-- pseudo-role, so `revoke ... from public` alone leaves anon's own grant
-- untouched. Confirmed live via pg_proc.proacl before and after this file.
revoke execute on function public.v_payments_attributed_definition_probe() from public;
revoke execute on function public.v_payments_attributed_definition_probe() from anon;
grant execute on function
  public.v_payments_attributed_definition_probe()
  to authenticated;

drop function if exists public.debug_v_payments_attributed_definition();

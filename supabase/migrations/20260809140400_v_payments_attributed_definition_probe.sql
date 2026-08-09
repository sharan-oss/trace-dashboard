-- Test-support only: lets the test suite (which holds only a publishable
-- key, per this dashboard's RLS-only access model) read back
-- v_payments_attributed's own view definition text.
--
-- Added for task-5 review finding IMPORTANT 3: the join to
-- public.v_ad_name_resolution had zero test coverage, because
-- ad_key_type = 'ad_name' matches zero live payment rows today, so no query
-- over live data can prove the join is wired up. This lets a test assert
-- the join survives structurally -- it fails the moment the join is
-- removed from the view, regardless of what the live data looks like.
--
-- Hardcoded to this one view, not a general catalog-introspection RPC, so
-- it cannot be used to read the definition of any other object.
create or replace function public.debug_v_payments_attributed_definition()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select pg_get_viewdef('public.v_payments_attributed'::regclass);
$$;

grant execute on function
  public.debug_v_payments_attributed_definition()
  to anon, authenticated;

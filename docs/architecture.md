# Trace Dashboard Architecture

## System Overview

```
Trace's Supabase project (ggfkbcdegkpqrjmqjfyw)
  clients, products, sessions, events, payments
  → RLS policies (is_admin / client_id JWT claims)
      ↑ claims injected at sign-in by
        public.custom_access_token_hook (reads auth.users.raw_app_meta_data)

Next.js Server Components (this repo)
  → src/lib/supabase/server.ts (createClientWithJwt / createServerClient)
      → publishable key + Authorization: Bearer <jwt>
  → src/app/**/page.tsx (server-side data fetching, no client-side fetch of tenant data)
```

This dashboard's application code never writes to Trace's five core tables and never uses Trace's secret/service-role key — see `.claude/rules/invariants.md` and `.claude/rules/auth-security.md` for the hard rules, including the one signed-off exception (a 2026-08-09 admin-run backfill migration) and the dashboard-owned tables that do carry deliberate write policies.

## Identity → claims → RLS, end to end

1. A user (today: one of two Phase 0 test users; later: a real Trace client contact or Sharan) signs in via Supabase Auth.
2. `public.custom_access_token_hook` runs at sign-in, reads that user's `raw_app_meta_data`, and copies `is_admin`/`client_id` onto the JWT's top-level claims. See `docs/adr/001-publishable-key-and-custom-access-token-hook.md` for why this mechanism was chosen over hand-signed JWTs.
3. Every Supabase query this app makes carries that JWT. RLS policies (`supabase/migrations/20260707000000_dashboard_rls_policies.sql`) read `auth.jwt() ->> 'is_admin'` / `'client_id'` and scope rows accordingly — `clients` on its own `id`, the other four tables on their `client_id` foreign key.
4. There is no other path to this data. App-layer `WHERE client_id = ...` filtering is not used as a substitute for RLS anywhere in this codebase.

## Phase 0 vs Phase 2 identity

Today (Phase 0), there's no login UI. `src/lib/auth/dev-identity.ts` picks an identity from the `DEV_ROLE`/`DEV_CLIENT_ID` env vars and signs in as one of two real Supabase Auth test users via `signInWithPassword`, caching the session in memory per role and refreshing it lazily ~60s before expiry. This exercises the *real* RLS + hook pipeline above — it is not a bypass of RLS, just a stand-in for a login screen. See `docs/adr/002-env-driven-dev-identity-stub.md`, and `docs/adr/003-lazy-session-refresh-for-dev-identity-stub.md` for why the earlier `npm run dev:session` script and the static `DEV_ADMIN_JWT`/`DEV_CLIENT_JWT` vars were removed.

Phase 2 replaces the stub's caller with a real Supabase Auth session (magic link or email/password) from an actual login page. Steps 2-4 above don't change — the hook and RLS policies are shared, not re-implemented.

## Current status, infra details, and what's next

See `docs/STATUS.md` — kept up to date at the end of each phase.

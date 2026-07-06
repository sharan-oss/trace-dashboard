---
globs: ["src/lib/auth/**", "src/lib/supabase/**", "supabase/migrations/**"]
---

# Auth & Security Model

Two audiences: **Admin** (Sharan, full access across every client) and **Trace clients** (each logged-in user sees only rows where `client_id` matches their own).

## RLS
- Every table this dashboard reads has an RLS policy matching the relevant identity column against a JWT claim — `clients` on its own `id` (it IS the tenant), `products`/`sessions`/`events`/`payments` on their `client_id` foreign key. See `supabase/migrations/20260707000000_dashboard_rls_policies.sql`.
- Admin access is a separate `is_admin` claim, OR'd into each policy's condition — not the secret/service-role key. The secret key bypasses RLS entirely; reserve it for one-off scripts run outside the app, never inside a request handler.
- Policies are read-only (`USING` only, no `WITH CHECK`) — this dashboard never writes to Trace's tables. If a future feature needs writes, add `WITH CHECK` deliberately, don't assume it's covered.
- Test RLS policies via the actual client SDK with a real (or test) user JWT — **never** the Supabase SQL editor, which bypasses RLS.

## Claims — Custom Access Token Hook
- `is_admin`/`client_id` claims are injected into JWTs at sign-in via a Postgres Custom Access Token Hook (`public.custom_access_token_hook`, see `supabase/migrations/20260707000001_custom_access_token_hook.sql`), reading from `auth.users.raw_app_meta_data`. Enabled via Supabase Dashboard → Authentication → Auth Hooks (no SQL/API path for enabling it — if it's ever disabled, it must be re-enabled there).
- Phase 0's admin-bypass stub and Phase 2's real client login share this same mechanism — don't build a second, parallel way to inject claims.

## Phase 0 dev-identity stub
- `src/lib/auth/dev-identity.ts` reads `DEV_ROLE=admin` or `DEV_CLIENT_ID=<uuid>` from env and selects a pre-obtained test-user session JWT (`DEV_ADMIN_JWT` / `DEV_CLIENT_JWT`).
- Get fresh session JWTs (they expire ~1hr) by running `npm run dev:session` (`scripts/get-dev-session.ts`) — signs in as the two Phase 0 test users using the publishable key only, no secret key involved.
- This stub is temporary. Once Phase 2 ships real Supabase Auth login, replace `getDevJwt()`'s callers with the real session, and delete the dev-identity files.

## Never do this
- Never use a manually-signed JWT / legacy shared JWT secret to fabricate claims — this project uses Supabase's own Auth + Custom Access Token Hook exclusively, matching Trace's own migration to modern publishable/secret keys.
- Never put the secret/service-role key, or any raw signing secret, in `.env.local`, code, or `.claude/settings.local.json` (that file is gitignored, but still shouldn't hold live secrets long-term).

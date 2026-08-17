---
globs: ["src/lib/auth/**", "src/lib/supabase/**", "supabase/migrations/**"]
---

# Auth & Security Model

Three audiences: **super admin** (Sharan, plus full control of the user list), **team** (anyone with an `@alttredmiinds.com` Google address — full data access across every client, and manages the client users they added), and **Trace clients** (each logged-in user sees only rows where `client_id` matches their own). Team and super admin both carry `is_admin`, so every data-layer policy still sees exactly two cases; `is_super` separates them only inside `app_users`.

## RLS
- Every table this dashboard reads has an RLS policy matching the relevant identity column against a JWT claim — `clients` on its own `id` (it IS the tenant), `products`/`sessions`/`events`/`payments` on their `client_id` foreign key. See `supabase/migrations/20260707000000_dashboard_rls_policies.sql`.
- Admin access is a separate `is_admin` claim, OR'd into each policy's condition — not the secret/service-role key. The secret key bypasses RLS entirely; reserve it for one-off scripts run outside the app, never inside a request handler.
- Policies on **Trace's five core tables** are read-only (`USING` only, no `WITH CHECK`) — application code never writes to them, and a write is refused outright. The one exception is a one-off admin-run migration with Sharan's explicit sign-off (this has happened once: the 2026-08-09 Love School normalisation).
- Tables **this dashboard owns** (`ads`, Slice B's `ad_accounts`/`ad_insights_daily`/`sync_runs`, and Phase 2's `app_users`) are the opposite case: they carry deliberate `WITH CHECK` policies on insert and update, permitting rows only when the JWT carries `is_admin`. This is required, not optional — in Postgres a `USING`-only policy denies writes entirely, and the service-role key is forbidden inside a request handler. If a future feature needs writes, add `WITH CHECK` deliberately; don't assume it's covered.
- Test RLS policies via the actual client SDK with a real (or test) user JWT — **never** the Supabase SQL editor, which bypasses RLS.

## Claims — Custom Access Token Hook
- `is_admin`/`client_id` claims are injected into JWTs at sign-in via a Postgres Custom Access Token Hook (`public.custom_access_token_hook`, see `supabase/migrations/20260707000001_custom_access_token_hook.sql`), reading from `auth.users.raw_app_meta_data`. Enabled via Supabase Dashboard → Authentication → Auth Hooks (no SQL/API path for enabling it — if it's ever disabled, it must be re-enabled there).
- Phase 0's admin-bypass stub and Phase 2's real client login share this same mechanism — don't build a second, parallel way to inject claims.

## Sign-in (Phase 2, 2026-08-17)
- **Google OAuth is the only login method.** No passwords, no magic links, no invite emails: adding someone means inserting their email into `public.app_users`, and they are in the moment they sign in with Google. Design: `docs/superpowers/specs/2026-08-17-phase-2-auth-design.md`.
- Three tiers — super admin (an `app_users` row), team (**any verified `@alttredmiinds.com` address, with no row at all**), client user (an `app_users` row naming their one `client_id`). Never add a second membership mechanism for the team; deactivating the Google Workspace mailbox is the removal path.
- `app_users`' own RLS **is** the permission matrix (super admin manages every row; a team member only rows where `invited_by` is their own email; insert forces `invited_by` to the caller's address). Don't re-implement any of it in the app — read the table and render what comes back.
- The hook's `raw_app_meta_data` branch runs **first and unconditionally**. It is what keeps the two test users and `ads-sync@trace.local` working; don't reorder it. New email-based branches require `email_confirmed_at`, which is the guard against someone self-registering an `@alttredmiinds.com` address they don't own — so Supabase's "Confirm email" must stay on, and the Email provider must stay enabled.
- Sessions are cookies via `@supabase/ssr`. Read identity with `getIdentity()` (`src/lib/auth/session.ts`), which uses `supabase.auth.getClaims()` — **never `getSession()` in server code**, which does not revalidate the token. `src/proxy.ts` is an optimistic check only; authorization is RLS.
- `createClientWithJwt` lives in `src/lib/supabase/jwt-client.ts`, deliberately apart from `server.ts`, so the sync identity and the test suite never import `next/headers`.

## Never do this
- Never use a manually-signed JWT / legacy shared JWT secret to fabricate claims — this project uses Supabase's own Auth + Custom Access Token Hook exclusively, matching Trace's own migration to modern publishable/secret keys.
- Never put the secret/service-role key, or any raw signing secret, in `.env.local`, code, or `.claude/settings.local.json` (that file is gitignored, but still shouldn't hold live secrets long-term).

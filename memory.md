# Memory — Trace Dashboard Phase 0 (Walking Skeleton)

Last updated: 2026-07-07

## What was built

- Scaffolded Next.js app in this repo matching `sharan-oss/trace`'s exact stack: Next.js 16.2.9, React 19.2.4, TypeScript strict, Tailwind v4, shadcn/ui (`base-nova` preset, neutral base color, lucide icons). `package.json`/`components.json` mirror Trace's.
- Git repo initialized with the `sharan-oss` identity/SSH alias (same pattern as the `Trace` repo: `user.email sharan@alttredmiinds.com`, `user.name sharan-oss`, remote `git@github-sharan-oss:sharan-oss/trace-dashboard.git`). Pushed to `main`.
- Deployed to Vercel: **https://trace-dashboard-alpha.vercel.app** (project `trace-dashboard` under `sharan-v-s-projects`).
- Supabase client helpers: `src/lib/supabase/client.ts` (browser) and `src/lib/supabase/server.ts` (`createClientWithJwt`/`createServerClient`) — use the **publishable key** (`sb_publishable_...`), never the legacy anon key or secret/service-role key.
- Applied two migrations directly to the live Trace Supabase project (`ggfkbcdegkpqrjmqjfyw`) via the Supabase MCP: `supabase/migrations/20260707000000_dashboard_rls_policies.sql` (read-only SELECT policies on clients/products/sessions/events/payments, matched on `is_admin` or `client_id` JWT claims) and `20260707000001_custom_access_token_hook.sql` (Postgres function injecting those claims from `auth.users.raw_app_meta_data` into JWTs at sign-in).
- Enabled the Custom Access Token Hook in the Supabase Dashboard (Authentication → Auth Hooks) — done manually by Sharan, no API/SQL path exists for this step.
- Created two Phase 0 test auth users (`dashboard-admin-test@trace.local` with `is_admin: true`, `dashboard-client-test@trace.local` with `client_id: cb7daf9d-28f1-4699-a587-afb6e2ec44da`, the "Love School" client) via a one-off Admin API script that used Trace's secret key transiently and was deleted immediately after.
- `scripts/get-dev-session.ts` (`npm run dev:session`) signs in as those two test users (publishable key only) and prints fresh session JWTs to paste into `.env.local` as `DEV_ADMIN_JWT`/`DEV_CLIENT_JWT` — they expire ~1hr.
- `src/lib/auth/dev-identity.ts` — env-driven dev-identity stub (`DEV_ROLE=admin` or `DEV_CLIENT_ID=<uuid>`), Phase 0's admin-bypass mechanism, to be deleted once Phase 2 ships real login.
- `src/app/page.tsx` — proof-of-concept page querying `payments` count through both the admin JWT and the scoped test-client JWT side by side.
- Repo context docs: `CLAUDE.md` + `.claude/rules/{data-model,invariants,auth-security,workflow}.md`, sourced from `2026-07-06-trace-dashboard-kickoff-guide.md`.

## Decisions made

- Explicitly avoided all legacy Supabase mechanisms per Sharan's direction: publishable/secret keys instead of legacy anon/service_role JWT keys, and a Custom Access Token Hook instead of hand-signing JWTs with a legacy shared secret. Confirmed via live docs/web search this is current (2026) best practice for multi-tenant RLS claim injection.
- Phase 0's test-identity mechanism (Custom Access Token Hook + `raw_app_meta_data`) is intentionally the same mechanism Phase 2's real client login will use — no throwaway parallel path.
- RLS policies are read-only (`USING` only, no `WITH CHECK`) since this dashboard never writes to Trace's tables.
- No new DB indexes were needed for RLS — existing composite indexes already lead with the matched columns (`clients.id` is PK; `products`/`sessions`/`events` lead `(client_id, ...)`; `payments` has a dedicated `client_id` index).

## Problems solved

- `create-next-app` rejects directory names with spaces/capitals (`Trace Dashboard`) — scaffolded into a temp subdirectory with a valid name, then `rsync`'d contents up and removed the temp dir.
- Discovered the git identity mismatch early: global git config is `sharanvkt@gmail.com`, but `sharan-oss/trace-dashboard` (like the `Trace` repo) needs the per-repo override (`sharan@alttredmiinds.com` / `sharan-oss`) and the SSH host alias `github-sharan-oss` already set up in `~/.ssh/config`.
- Vercel CLI needed a fresh device-auth login (no cached credentials) — completed interactively via the printed device URL.
- Found that `.claude/settings.local.json` (a Claude Code artifact, not something written deliberately) had captured Trace's secret key in plaintext inside a recorded Bash permission string. Gitignored that file (plus `.claude/scheduled_tasks.lock`) and stripped the secret from it — confirmed it was never committed to git.

## Current state

- Phase 0 is fully done and verified: the deployed URL shows real, RLS-scoped Supabase data — admin JWT sees 132 payments, the scoped test-client JWT sees 121 — cross-checked against a raw SQL count on the live table, so it's a genuine database-level guarantee, not app-layer filtering.
- Vercel production env vars are set for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DEV_ROLE`, `DEV_ADMIN_JWT`, `DEV_CLIENT_ID`, `DEV_CLIENT_JWT` — note the JWT values will go stale after ~1hr and need `npm run dev:session` + re-upload to stay working on the deployed proof page.
- All work is committed and pushed to `sharan-oss/trace-dashboard` main branch (2 commits so far).

## Next session starts with

Phase 1 — Revenue Overview (admin): total revenue (sum of `payments.amount` where `status = 'paid'`), per-client/per-product breakdown, conversion rate (sessions vs. paid payments), and a `paid_at`-based time series. Build this behind the Phase 0 admin-bypass stub; per the Workflow Rule, browse current best-practice examples/dashboard patterns before choosing chart library or layout.

## Open questions

- The Phase 0 proof page's `DEV_ADMIN_JWT`/`DEV_CLIENT_JWT` values are short-lived test tokens — decide whether Phase 1 keeps refreshing them manually via `npm run dev:session`, or whether it's worth the small time investment to have the dev stub call `signInWithPassword` at request time (slower per-request, but always fresh) before more feature work piles on top of the current approach.
- No decision yet on chart library, color system, or component-level visual design for Phase 1 — explicitly deferred to be discussed with Sharan first (per the kickoff guide and Workflow Rule).

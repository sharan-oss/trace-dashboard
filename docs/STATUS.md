# Trace Dashboard — Status

Updated at the end of each phase (not each session — see `memory.md` / `/remember` for session-to-session handoff). If this file and `memory.md` disagree, trust this file for anything phase-level and `memory.md` only for very recent in-progress detail.

## Infra inventory

- **Supabase project**: `trace`, ref `ggfkbcdegkpqrjmqjfyw`, region `ap-south-1`. Same project Trace's own backend uses — this dashboard only reads it, via RLS, never the secret/service-role key.
- **Vercel**: project `trace-dashboard` under the `sharan-v-s-projects` team. Production URL: **https://trace-dashboard-alpha.vercel.app**.
- **GitHub**: `sharan-oss/trace-dashboard` (note: this account, not the default machine git identity — see `git config` in this repo, or `docs/adr/` if a mismatch ever recurs).
- **Local repo**: `/Users/sharanv/apps/Trace Dashboard`. Sibling repo `/Users/sharanv/apps/Trace` is Trace's own backend, read-only reference for schema/conventions.

## Phase checklist

- [x] **Phase 0 — Walking skeleton** (complete, 2026-07-07)
  - Next.js 16.2.9 / React 19.2.4 / Tailwind v4 / shadcn (`base-nova`) scaffold matching Trace's stack
  - Deployed to the Vercel URL above
  - RLS policies live on `clients`/`products`/`sessions`/`events`/`payments` (`supabase/migrations/20260707000000_dashboard_rls_policies.sql`)
  - Custom Access Token Hook live and enabled (`supabase/migrations/20260707000001_custom_access_token_hook.sql` + Dashboard toggle) — see `docs/adr/001-publishable-key-and-custom-access-token-hook.md`
  - Env-driven dev-identity stub working (`src/lib/auth/dev-identity.ts`, `scripts/get-dev-session.ts`) — see `docs/adr/002-env-driven-dev-identity-stub.md`
  - Proof page (`src/app/page.tsx`) verified live: admin JWT saw 132 payments, scoped test-client JWT saw 121, cross-checked against a raw SQL count on the live table
- [ ] **Phase 1 — Revenue overview (admin)**: total revenue, per-client/per-product breakdown, conversion rate, `paid_at`-based time series. Not started.
- [ ] **Phase 2 — Multi-tenant client auth**: real Supabase Auth login (magic link or email/password), replacing the Phase 0 dev-identity stub. Not started.
- [ ] **Phase 3 — Funnel & attribution views**: ordered funnel drop-off, UTM/attribution breakdown, device/network breakdown. Not started.
- [ ] **Phase 4 — Polish pass**: empty states, loading states, responsive pass, nav review. Not started.

(Full phase goals and "done when" criteria: `docs/deliverables/2026-07-06-trace-dashboard-kickoff-guide.md`.)

## Temporary things that must be revisited

- `src/lib/auth/dev-identity.ts`, `scripts/get-dev-session.ts`, and the `DEV_ROLE`/`DEV_CLIENT_ID`/`DEV_ADMIN_JWT`/`DEV_CLIENT_JWT` env vars are Phase 0 scaffolding — delete once Phase 2 ships real login (see ADR 002).
- The two test auth users (`dashboard-admin-test@trace.local`, `dashboard-client-test@trace.local`) live permanently in Trace's `auth.users` table until manually deleted.
- `DEV_ADMIN_JWT`/`DEV_CLIENT_JWT` (both locally in `.env.local` and in Vercel's production env vars) expire ~1hr after being minted — refresh via `npm run dev:session`, then re-upload to Vercel (`vercel env add <NAME> production --force`) if the deployed proof page needs to keep working.

## Open questions

- Whether to keep manually refreshing dev-session JWTs each time they go stale, or have the dev-identity stub call `signInWithPassword` per request instead (slower per request, but always fresh) — worth deciding before Phase 1 adds more pages that depend on this.
- Chart library, color system, and component-level visual design for Phase 1 are explicitly undeferred — bring options to Sharan first per `.claude/rules/workflow.md`, don't default to a library from training data.

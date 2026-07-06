# ADR 002: Env-driven dev-identity stub, sharing Phase 2's claim mechanism

**Date:** 2026-07-07
**Status:** Accepted — temporary, superseded by Phase 2

## Decision

For Phase 0 (before any login UI exists), select an "acting as" identity via env vars — `DEV_ROLE=admin` or `DEV_CLIENT_ID=<uuid>` — resolved in `src/lib/auth/dev-identity.ts` to a pre-obtained real Supabase Auth session JWT (`DEV_ADMIN_JWT` / `DEV_CLIENT_JWT`, refreshed via `npm run dev:session`). No UI toggle, no separate claim-injection path from what Phase 2's real login will use.

## Reasoning

The kickoff guide's Phase 0 spec calls for "a minimal admin-bypass auth stub — not a real login screen yet, just enough to run the app locally acting as admin or as a specific test client_id." Two shapes were considered: an env-var driven stub, or a small dev-only UI toggle (dropdown/switch) stored in a cookie. Env-driven was chosen — no throwaway UI code to build and later delete, and it forces every "identity switch" through the same JWT-carrying code path production requests will use, rather than a special-cased dev branch in the request handlers.

Critically, this stub does **not** fabricate its own claim-injection mechanism. It authenticates as two real Supabase Auth users whose `app_metadata` is read by the same `public.custom_access_token_hook` that will serve Phase 2's real client logins (see ADR 001). This means Phase 0's RLS testing is exercising the actual production claims pipeline, not a parallel mock of it — when Phase 2 ships, there is no "the real thing behaves differently than what we tested" risk.

## Trade-offs

- Test-user session JWTs expire after ~1hr (standard Supabase Auth session lifetime), requiring a manual `npm run dev:session` re-run and a `.env.local` / Vercel env var update to keep the Phase 0 proof page working over time. Acceptable for Phase 0; worth revisiting if it becomes a recurring friction point during Phase 1 (see `docs/STATUS.md`).
- The two test users (`dashboard-admin-test@trace.local`, `dashboard-client-test@trace.local`) are permanent rows in Trace's live `auth.users` table until someone deletes them — a minor cleanup item, not urgent since they carry no real customer data and only ever grant read access matching their own claims.
- This entire mechanism (`src/lib/auth/dev-identity.ts`, `scripts/get-dev-session.ts`, the `DEV_*` env vars) is explicitly temporary and should be deleted once Phase 2 ships real login — it is not meant to accumulate features.

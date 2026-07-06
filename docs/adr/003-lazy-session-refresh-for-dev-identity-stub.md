# ADR 003: Lazy in-memory session refresh for the dev-identity stub

**Date:** 2026-07-07
**Status:** Accepted

## Decision

Replace the Phase 0 dev-identity stub's manual JWT refresh (`npm run dev:session` → paste into `.env.local` and re-upload to Vercel prod env vars) with a lazy, in-memory-cached `signInWithPassword` call inside `getDevJwt(role)` (`src/lib/auth/dev-identity.ts`). Each call returns the cached token if it has more than 60s of validity left, otherwise signs in fresh and re-caches. `createServerClient()` and the proof page (`src/app/page.tsx`) now `await` this instead of reading static `DEV_ADMIN_JWT`/`DEV_CLIENT_JWT` env vars.

## Reasoning

The static-token approach (ADR 002) required a manual refresh + Vercel env var re-upload roughly every hour, which was already noted as an open question in `docs/STATUS.md` before Phase 1 adds more pages depending on it.

Researched current (2026-07) Supabase/Next.js server-auth best practice: the documented pattern (`@supabase/ssr` + middleware-driven cookie refresh) is built for real per-browser-user login sessions. Building that now would duplicate Phase 2's actual login work for what's explicitly a temporary, two-fixed-test-user stub (ADR 002: "not meant to accumulate features") — over-engineering for the problem at hand.

Instead, kept the same `signInWithPassword` mechanism the stub already used (still exercises the real Custom Access Token Hook + RLS, no parallel mock — see ADR 001/002), just called lazily from the request path with an in-memory cache instead of a standalone script. On Vercel, a cold start just re-signs-in once; a warm instance reuses the cached token with no extra network call.

## Trade-offs

- The in-memory cache doesn't persist across cold starts/separate Lambda instances, so a cold start pays one extra `signInWithPassword` round-trip on first request — acceptable for a low-traffic Phase 0/1 dev stub.
- `scripts/get-dev-session.ts` and `npm run dev:session` were deleted rather than kept as a standalone debug tool, to avoid two copies of the same sign-in logic; the sign-in call itself is easy to re-add if a one-off script is ever needed again.
- Still temporary: this whole file is deleted once Phase 2 ships real Supabase Auth login (unchanged from ADR 002).

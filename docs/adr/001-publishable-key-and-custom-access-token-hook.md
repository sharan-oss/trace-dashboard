# ADR 001: Publishable/secret keys + Custom Access Token Hook, not legacy anon key + hand-signed JWTs

**Date:** 2026-07-07
**Status:** Accepted

## Decision

Connect to Trace's Supabase project using the modern **publishable key** (`sb_publishable_...`), never the legacy JWT-format anon key. Inject `is_admin`/`client_id` claims into JWTs at sign-in via a Postgres **Custom Access Token Hook** (`public.custom_access_token_hook`, reading `auth.users.raw_app_meta_data`), rather than hand-signing HS256 JWTs with the project's legacy shared JWT secret.

## Reasoning

The first working version of Phase 0's RLS test path used the legacy anon key and a plan to hand-sign test JWTs with the project's legacy JWT secret (a shared HS256 signing secret). Sharan explicitly rejected this ("let's not go for legacy supabase setup") before it was implemented.

Live research (Supabase docs + web search, current as of 2026-07) confirmed this wasn't just a style preference:
- Supabase is deprecating legacy anon/service_role JWT keys in favor of publishable (`sb_publishable_...`) and secret (`sb_secret_...`) keys, precisely because the legacy scheme tightly couples the JWT secret to both Postgres roles and offers no independent rotation.
- The publishable key is a drop-in replacement for the anon key — same `@supabase/supabase-js` client code, same RLS behavior, no legacy key or shared signing secret ever needs to exist in this repo.
- For injecting custom multi-tenant claims (`client_id`, `is_admin`) into JWTs, the Custom Access Token Hook is Supabase's own documented, supported mechanism — not a workaround. Hand-signing tokens would have required possessing the project's legacy JWT secret, a credential with the blast radius of "can forge a session as anyone," used only for Phase 0 test scaffolding.

## Trade-offs

- Requires two real Supabase Auth test users (created once via a one-off script using the secret key, immediately deleted after) instead of a simpler "print a fake JWT" script — slightly more setup, but no long-lived powerful secret needed anywhere in this repo or its command history.
- The hook has to be enabled through the Supabase Dashboard UI (Authentication → Auth Hooks) — there is no SQL/API path for that one step, so it can't be scripted or re-applied automatically if ever disabled.
- Test-user session JWTs expire (~1hr) and must be refreshed via `npm run dev:session` — acceptable for Phase 0 scaffolding, revisited if Phase 1 development friction from this becomes a problem (see `docs/STATUS.md` open questions).

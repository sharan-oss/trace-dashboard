# Memory — Trace Dashboard

Last updated: 2026-08-17 (Phase 2 auth shipped and live; Meta creative pipeline still un-run from the previous session)

## What was built

**Phase 2 auth — real Google-only login (commit `f978af4`, pushed to `main`).** Tests 340 → **351**. Design spec: `docs/superpowers/specs/2026-08-17-phase-2-auth-design.md`.

- **Migration `20260817120000_app_users_and_auth_hook_v2.sql`** — the `app_users` allowlist (`email` unique+lowercased, `role 'super_admin'|'client'`, `client_id`, `invited_by`, `created_at`) plus Custom Access Token Hook v2. Two super-admin rows seeded: `sharanvkt@gmail.com`, `sharan@alttredmiinds.com`.
- **New app files**: `src/proxy.ts`, `src/lib/auth/session.ts` (`getIdentity`/`hasAccess`), `src/lib/auth/actions.ts` (`signOut`), `src/lib/supabase/jwt-client.ts`, `src/app/(auth)/{layout,login/page,login/google-button,no-access/page}.tsx`, `src/app/auth/callback/route.ts`, `src/app/(dashboard)/settings/users/{page,actions,add-user-form}.tsx`, `src/components/account-menu.tsx`, `tests/app-users-rls.test.ts`.
- **Rewritten**: `src/lib/supabase/server.ts` (cookie sessions via `@supabase/ssr`), `src/lib/auth/api-guard.ts` (+`requireCronOrAdminOrOwner`), `src/app/(dashboard)/layout.tsx` (the real gate), `src/components/app-shell.tsx`, `sidebar-nav.tsx` (admin-only Users item), `tests/helpers/supabase.ts` (now owns the test sign-in as `getTestJwt`).
- **Deleted**: `src/lib/auth/dev-identity.ts` and the `DEV_ROLE`/`DEV_CLIENT_ID` env vars.
- **Deps**: added `@supabase/ssr` ^0.12.4, bumped `@supabase/supabase-js` to ^2.112.3 (ssr peers ^2.111.0).
- Docs updated: `docs/STATUS.md` (Phase 2 ticked), `CLAUDE.md`, `.claude/rules/auth-security.md`, `.claude/rules/data-model.md`.

## Decisions made

- **Google OAuth is the only login method.** No passwords, magic links, or invite emails — adding someone = inserting an allowlist row; they're in the moment they sign in.
- **Team membership is the email domain, with no rows at all.** A verified `@alttredmiinds.com` address grants `is_admin`. Google Workspace *is* the team directory, so deactivating a mailbox removes dashboard access with no second system to maintain. Rejected "rows for everyone" as YAGNI — revisit only if per-person blocking without touching Workspace is ever needed.
- **Inviter-scoped management + super admin sees everything.** Team members manage only users where `invited_by` = their own email; super admin manages all. This keeps least privilege *and* fixes the orphan problem that makes pure inviter-based removal a bad pattern (Slack/Notion/Vercel avoid it).
- **`app_users`' RLS *is* the permission matrix** — insert forces `invited_by` to the caller's own address so the audit trail can't be forged; only a super admin can mint another super admin. The Users page does **no** filtering of its own; it reads the table and renders what comes back.
- **Claims stay byte-identical to Phase 0's** (`is_admin`, `client_id`), which is why all 11 existing RLS policy sets, every view and every RPC needed **zero** changes. `is_super` is new and read only by `app_users`' policies and the UI.
- **The hook's `raw_app_meta_data` branch runs first and unconditionally** — that's what keeps the two test users and `ads-sync@trace.local` working. Don't reorder it.
- **Proxy is an optimistic check only.** Route protection is re-checked server-side in the dashboard layout, and RLS is the real guarantee. Per Next's own guidance.
- **Client users can trigger Sync now** for their own account; ownership is proven by reading `ad_accounts` through the *caller's* JWT, never an app-layer `client_id` comparison.
- **Revocation is eventual** (~15 min): deleting a row kills access at the next token refresh. Accepted as inherent to JWT claims.

## Problems solved

**Auth-specific — don't rediscover these:**
- **Next 16 renamed Middleware → `proxy.ts`.** It lives at `src/proxy.ts` (same level as `src/app`), exports `proxy`, and the build log confirms it as "ƒ Proxy (Middleware)". Bundled docs are at `node_modules/next/dist/docs/`.
- **Never use `getSession()` in server code** — it doesn't revalidate the token. Use `supabase.auth.getClaims()`, which verifies locally against the project JWKS. `getIdentity()` wraps it in React `cache()` so a layout and its page don't verify twice.
- **`createClientWithJwt` had to move out of `server.ts`** into `src/lib/supabase/jwt-client.ts` — once `server.ts` imported `next/headers`, the test suite and the sync identity would have pulled it into a Node context and every suite would break.
- **`tests/api-ads-accounts.test.ts` calls route handlers with a bare `Request`**, so `cookies()` throws outside a request scope. Fixed by mocking `@/lib/auth/session` (not the guard), which keeps `requireAdmin`'s real logic under test; added 403 cases for client-user and signed-out callers.
- **The Email provider must stay enabled and "Confirm email" must stay on.** Disabling email auth would break the test users and `ads-sync@trace.local`; the hook's `email_confirmed_at` guard is what stops someone self-registering an `@alttredmiinds.com` address they don't own.
- **Google's consent screen must be "External"**, not Internal — Internal restricts sign-in to the Workspace domain and would lock out every client user. The console is now "Google Auth Platform" (`console.cloud.google.com/auth/*`), not the old APIs & Services consent screen.
- **`ERR_SSL_PROTOCOL_ERROR` on localhost** = the browser upgraded to `https://localhost:3000` while Next serves http. Fix in Brave: `brave://settings/shields` → Upgrade connections to HTTPS → Off/Standard.
- **Supabase silently falls back to the Site URL** when a `redirectTo` isn't in the Redirect URLs allow-list. That's what sent a live-domain login to `localhost:3000` with `flow_state_already_used`. Both environments need explicit allow-list entries.
- A test that attempts a real delete on a bootstrap row and asserts a count the caller can't see **passes either way** — destructive with zero diagnostic power. Rewritten to create its own row and prove a foreign delete removes nothing.

**The Occultyogis sync that ran forever (diagnosed 2026-08-17, killed not fixed — the durability fix landed 2026-08-24, see "Next session" item 2):**
- The nightly cron syncs **every account sequentially inside ONE invocation**, capped at `maxDuration = 60`. Timestamps proved the squeeze: Love School's two accounts finished at 21:44:46 and 21:44:50, so Occultyogis began with ~50s and Vercel killed it mid-run.
- **A Vercel timeout terminates the process — there is no cleanup hook**, so `runAdAccountSync`'s `catch` (the only thing that closes a run row as `failed`) never runs.
- That turns a timeout into permanent damage: the concurrency check matches `status = 'running'` with **no age bound**, so one orphan 409s every future sync of the account forever. This is the bug that actually froze Occultyogis, not the timeout itself.
- Hobby's fluid-compute maximum is **300s** — the `maxDuration = 60` leaves 5× on the table. But 60s was never survivable anyway: 2,540 ads over a 28-day daily-insights walk is 10+ paged calls, and the client's own pacing can sleep up to 300s on a score block.
- `ad_accounts.status` is read in four places; only `loadActiveAccounts` filters on `'active'`. `'paused'` therefore stops the nightly while leaving manual sync, ownership checks and all UI untouched — `'disconnected'` would also have 422'd manual syncs.

**Carried forward from the previous session (Meta rate limits — still true, still costly):**
- `thumbnail_width`/`thumbnail_height` are **"Rendered"** — a cold image resize per row, which forces page size to 25 and turns one walk into ~102 calls. `image_hash`/`video_id`/`object_story_spec` are free.
- The binding limiter is the **ad-account API-level score: 60 points/300s on the dev tier, 1 point per read, and it publishes NO usage header** (`x-app-usage`/`x-ad-account-usage` both read 0% while throttled). Errors: code 17 or 80004, subcode 2446079.
- **`?ids=` and Graph batch requests are counted per id / per sub-request** — a 50-id call costs 50 points. Both look like optimisations and are traps. Edge *filters* are one call.
- Editing a CDN URL for a bigger rendition breaks the `oh=` signature (403). Over-requesting size via the API is free.
- Calling while blocked **extends the block**. Don't probe repeatedly.

## Current state

`main` pushed through **`f978af4`**. Typecheck clean, **351 tests green**, production build clean.

**Auth is live and working.** Verified end to end: `sharan@alttredmiinds.com` signs in via Google and the hook emits `is_admin: true, is_super: true`. Production (`https://trace-dashboard-alpha.vercel.app`) serves the new code — `/` 307s to `/login`, the Google button renders, `/landing` stays public, unauthenticated `POST /api/ads/sync` returns 403. Local sign-in confirmed by Sharan.

**Blocked at the very end of session:** logging in on the **live domain** bounced to `http://localhost:3000/?error=flow_state_already_used`. Diagnosed, not yet confirmed fixed — Supabase's Site URL was still localhost and the production callback was never allow-listed, so Supabase fell back to Site URL. Fix given, awaiting Sharan applying it.

**Occultyogis' Meta sync is switched off** (2026-08-17): `ad_accounts.status` for `act_1468167101279643` set to `'paused'`, and the orphaned run `4e4407db` closed as `failed`. Verified: zero rows stuck in `running`, the nightly now resolves only Love School's two accounts, Occultyogis' 3,193 insight rows intact. 351 tests green, typecheck clean, no source files changed. Sharan's call was to stop the bleeding and design the real fix later.

**Correction to last session's blocker list:** Vercel env is **no longer missing** `META_*`/`SYNC_IDENTITY_*`/`CRON_SECRET` — the nightly ran in production on 2026-08-16 and wrote real run rows, which it could not have done without them. Rotating the Meta token + app secret (pasted in chat 2026-08-10) is still owed.

Live data unchanged from last session:

| | ads | insight rows | creative urls | mirrored |
|---|---|---|---|---|
| Love School | 1,233 | 285 | 1,233 | 1,233 |
| Occultyogis | 2,540 | 3,193 | **0** | **0** |

## Next session starts with

1. **Confirm the live-domain login fix landed.** In Supabase → Auth → URL Configuration: Site URL = `https://trace-dashboard-alpha.vercel.app`, and Redirect URLs containing **both** `https://trace-dashboard-alpha.vercel.app/**` and `http://localhost:3000/**`. Test in a fresh private window (a spent flow state reproduces the error regardless of config). Add a Vercel preview wildcard if previews are used.
2. ~~Design the real sync-durability fix~~ **BUILT 2026-08-24** — all four parts plus the per-account score bucket: stale-run lease (`STALE_RUN_MAX_AGE_MS` 10 min), deadline-awareness (`src/lib/meta/deadline.ts`, threaded through client sleeps/page walks/sync phases/thumbnails — a run now closes its own row on budget exhaustion), `maxDuration` 300, per-account budget share AND per-account Meta client via the nightly's `makeMeta` factory, atomic claim via partial unique index `ad_sync_runs_one_running_per_account` (migration `20260824090000`), zombie-guarded run closes, age-bounded `running_now`, "Abandoned" render in `/ads/sync-log`. The two live orphans (Occultyogis manual 08-21, Love School "Alttred Miinds" nightly 08-22 — the latter silently cost Love School its 08-23 nightly and looked like "MNW" in the UI) were closed manually 2026-08-24. **Un-pausing `act_1468167101279643` remains Sharan's explicit call — he chose to keep it disabled for now (2026-08-24).**
3. **The Occultyogis creative run, never executed** — and it needs `full:true` specifically: all 2,540 ads still have `meta_image_hash`/`meta_video_id` null and the walk is incremental, so a routine sync can never fill them. Check the block cleared with one cheap call, then stop if it hasn't:
   `GET /act_1468167101279643/advideos?fields=id,picture,format{picture,width,height}&limit=25`
   If clear, one sync with `full:true` and watch `ad_sync_runs.api_calls` — should be **20–35, not ~100**. That number is the whole point of the rewrite:
   `POST /api/ads/sync {"meta_ad_account_id":"act_1468167101279643","date_from":"2026-08-16","date_to":"2026-08-16","kind":"manual","full":true,"thumbnail_limit":3000}`
   Then verify `creative_source_url` → `creative_thumbnail_path` fill in and Love School's 1,233 don't regress.
4. `cpa()` still returns ₹0 instead of "n/a" for zero-spend clients (MNW, Batra). `cac()` was fixed, `cpa()` wasn't. One-line fix, queued for three sessions now.

## Open questions

- **The client-user browser path is unverified** (one client, no switcher, no Users nav, Sync now scoped). It needs a second real Google account — a `+alias` won't work, since Google won't authenticate an address that isn't a real account. The scoping *is* proven at the RLS layer by `tests/app-users-rls.test.ts` against the live DB, which is where it's enforced.
- Whether `/advideos` pages cheaply with the `format` ladder, and what fraction of the 2,540 Occultyogis ads resolve a poster via `object_story_spec` vs `asset_feed_spec` vs neither. Both blocked before they could be probed. Documented fallback if coverage is poor: a paged `/adcreatives` read (19,606 rows against 2,540 ads — stragglers only).
- Whether to delete the two `@trace.local` test users and the legacy `raw_app_meta_data` hook branch. Can only happen once the test suite stops signing in as them; the test password is still committed in `tests/helpers/supabase.ts`.
- Razorpay L2 backfill still partial, so LTV:CAC stays understated.
- Chart categorical palette for >2 series is the only remaining colour decision.
- Meta App Review is still only needed for the future self-serve client "Connect Meta" OAuth flow — now unblocked on the auth side, since Phase 2 has shipped.

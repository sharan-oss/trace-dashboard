# Phase 2 — Real auth: Google-only, domain rule + allowlist

Status: approved 2026-08-17. Supersedes the Phase 0 dev-identity stub (ADR 002, ADR 003).

## The problem

The dashboard is deployed and unauthenticated. Every visitor to
`trace-dashboard-alpha.vercel.app` gets whatever identity the *server* holds —
`DEV_ROLE=admin` — so the browser has no identity at all and payment data for
every tenant is one URL away. Phase 2 makes the visitor the identity.

## Permission structure

| Capability | Super admin | Team (`@alttredmiinds.com`) | Client user |
|---|---|---|---|
| View analytics | All clients | All clients | Own account only |
| Add client users (any account) | ✓ | ✓ | ✗ |
| User list visibility | Everyone | Only users they added | — |
| Remove users | Anyone | Only users they added | ✗ |
| Remove team members | Google Workspace offboarding | ✗ | ✗ |
| Meta "Sync now" | ✓ | ✓ | ✓ own account only |
| Map/disconnect Meta accounts | ✓ | ✓ | ✗ |

Super admins: `sharanvkt@gmail.com`, `sharan@alttredmiinds.com`.

### Why inviter-scoped management, not pure role-based

Slack/Notion/Vercel gate removal on *role*, not on who clicked invite, because
inviter-based rules orphan users when the inviter leaves. This design keeps the
inviter scope for team members — least privilege over each other's client
setups — but pairs it with **super admin sees and manages everything**, which is
exactly the escape hatch that removes the orphan problem. There is always one
authority who can fix any row.

## Identity model

**Google sign-in is the only method.** No passwords, no magic links, no invite
emails. Adding a client user means inserting their email into an allowlist; they
sign in with Google and their verified address matches the row.

**Team membership needs no rows.** Google Workspace already *is* the team
directory: a verified `@alttredmiinds.com` address is the membership test.
Onboarding is "they get a mailbox"; offboarding is "the mailbox is deactivated"
— a thing that already happens, with no second system to remember.

One table, `public.app_users` — `email`, `role ('super_admin'|'client')`,
`client_id`, `invited_by`, `created_at`. Only super admins and client users have
rows.

## Claim resolution (Custom Access Token Hook v2)

At sign-in, in order:

1. `raw_app_meta_data` carries claims → emit them unchanged. *(Legacy branch,
   first and unconditional: the two Phase 0 test users and the `ads-sync`
   service identity live here. Keeps ~29 live-DB test suites and the nightly
   Meta sync working untouched.)*
2. `app_users` row with `role='super_admin'` → `is_admin: true`, `is_super: true`
3. Email domain is `alttredmiinds.com` → `is_admin: true`
4. `app_users` row with `role='client'` → `client_id: <their account>`
5. Otherwise → **no claims**. RLS yields zero rows everywhere; the app shows
   `/no-access`. Safe by construction — a random Google account signing in gets
   nothing, rather than being rejected by app logic that could have a bug.

Branches 2–4 additionally require `email_confirmed_at is not null`. That is what
stops someone self-registering `anyone@alttredmiinds.com` via email/password and
inheriting `is_admin`: Supabase's email confirmation goes to an address they do
not control. (The Email provider must stay enabled — the test users and the sync
identity authenticate with it.)

**The emitted claims are byte-identical to Phase 0's.** `is_admin` and
`client_id` mean exactly what they meant before, so all 11 existing RLS policy
sets, every `security_invoker` view, and every RPC are untouched by this work.
`is_super` is new and read only by `app_users`' own policies and the UI.

## Authorization boundaries

- **Data**: unchanged — RLS on the claims above, as today.
- **`app_users`**: its own RLS is the whole permission matrix. Select/delete
  require `is_super`, or `is_admin` **and** `invited_by = your email`. Insert
  forces `invited_by` to the inserter's own address (the audit trail cannot be
  forged), and only a super admin may mint another super admin. Client users
  match no policy, so the table does not exist as far as they are concerned.
  The Users page therefore needs no filtering logic — it reads the table and
  shows what comes back.
- **Route protection**: `src/proxy.ts` (Next 16 renamed Middleware → Proxy)
  refreshes the session cookie and redirects the signed-out to `/login`. Per
  Next's own guidance this is an *optimistic* check, not the security boundary —
  RLS remains the actual guarantee.
- **API routes**: `requireCronOrAdminOrOwner` adds a third path for client users
  on `POST /api/ads/sync` only, and proves ownership by reading `ad_accounts`
  through the *caller's own* RLS-scoped client — zero rows means 403. Account
  mapping routes stay admin-only.

## Revocation

Deleting a row kills access at the next token refresh, not instantly. The
access-token TTL is lowered to 15 minutes, making that the worst case. This is
inherent to every JWT-claims system; the alternative (a database round-trip per
request) buys little at this scale.

## Deliberately out of scope

- Self-serve "Connect Meta" OAuth for clients — needs Meta App Review.
- Editing `app_users` rows (remove and re-add instead).
- The `/landing` "Request Access" CTA destination.
- Per-person team blocking without touching Workspace. If the domain rule ever
  stops matching reality, the upgrade path is rows for team members too — but
  that buys a management UI and an approval flow we do not need today.

# Trace Dashboard — Project Kickoff Guide

> Paste this entire document as your first message to Claude Code in the new, empty dashboard repo. Work through it phase by phase — don't skip ahead. Each phase ends with a real browser check against live Supabase data before moving to the next.

## What This Project Is

This is the analytics dashboard for **Trace**, a multi-tenant payment + attribution platform (separate repo: `sharan-oss/trace`, live at `https://trace-it-app.vercel.app`). Trace collects payments (via Razorpay/TagMango), UTM attribution, and behavioral funnel data from client landing pages, storing everything in Supabase. This dashboard reads that data — it does not write to Trace's core tables, and it never touches Trace's payment/webhook logic.

Two audiences will use this dashboard:
- **Admin (Sharan)** — sees data across all clients
- **Trace's clients** — each sees only their own data, once client auth ships in Phase 2

## Trace's Data Model (source of truth — read before writing any query)

Five Postgres tables, all with Row Level Security **enabled** at the Postgres level already, but Trace's own backend uses a service-role key that bypasses RLS — so **no RLS policies exist yet**. Writing them is this project's job, not something to assume is already handled.

### `clients` — tenant/business
`id, name, api_key, domains[], gateway ('razorpay'|'tagmango'), razorpay_key_id, razorpay_key_secret_enc, razorpay_webhook_secret_enc, tagmango_api_key_enc, tagmango_webhook_secret_enc, created_at`

### `products` — catalog item per client
`id, client_id, slug, name, description, amount (smallest currency unit, e.g. paise), currency, gateway, thankyou_path, pabbly_webhook, created_at`. Unique on `(client_id, slug)`.

### `sessions` — one row per landing page visit
`id, client_id, product_id, fingerprint` (localStorage UUID linking visits from the same device), UTM fields (`utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid`), `referrer, landing_url`, device fields (`device_ram_gb, device_cpu_cores, device_brand, device_model, device_os, device_os_version`), network fields (`network_type, network_speed_kbps`), perf fields (`fcp_ms, tti_ms`), `created_at`.

### `events` — funnel steps
`id, session_id, client_id, product_id, event_type, created_at`. `event_type` is an **ordered** funnel: `page_load → form_open → form_start → form_submit → payment_open → payment_complete`. Always treat this as an ordered sequence when building funnel/drop-off views, not an unordered category.

### `payments`
`id, client_id, session_id, product_id, order_id (unique), payment_id (unique), gateway, status ('created'|'paid'|'failed'), amount, currency, customer_name, customer_email, customer_phone`, dedicated UTM columns (`utm_source, utm_medium, utm_campaign, fbclid, gclid`) plus `utm_params jsonb` (catch-all for extra params), `customer_data jsonb` (extra form fields beyond name/email/phone), `raw_payload jsonb` (full gateway webhook payload), `visit_count` (count of sessions by this fingerprint for this client+product, computed at payment time), `minutes_to_convert` (time from session start to payment), `created_at, paid_at`.

- `utm_params` can include `fbc_id`/`h_ad_id` — these are Meta ad-set/ad IDs, NOT the same as `fbclid`, which is Meta's click ID. Don't conflate the two when building attribution views.
- `raw_payload` can legitimately be `{}` even for a successfully paid transaction, if the webhook wasn't registered for that client (see Invariants below for why). Use `paid_at` as the reliable "did this actually get paid" signal, not `raw_payload` presence.

## Invariants — Never Violate These

- `*_secret_enc` columns (`razorpay_webhook_secret_enc`, `razorpay_key_secret_enc`, `tagmango_*_enc`) are AES-256-GCM **ciphertext**. Never query, decrypt, log, or display them in this dashboard. There is no legitimate reason for the dashboard to ever touch these columns.
- `payments.amount` is trustworthy as-is — Trace's backend always sources amount server-side from `products.amount`, never from client input, so you don't need to re-validate it here.
- Webhooks always return HTTP 200 in Trace regardless of internal success/failure (deliberate design so Razorpay/TagMango don't disable delivery). This means `raw_payload = '{}'` does not reliably mean "something's broken" — check `paid_at` instead when building any "is this data healthy" diagnostic.
- This dashboard connects to Trace's Supabase project using an **anon key + RLS**, never the service-role key. The service-role key and `ENCRYPTION_MASTER_KEY` belong to Trace's own env only and must never appear in this repo's `.env` files or code. Until RLS policies are written (Phase 0), an anon-key connection will correctly return zero rows for every table — that's expected at that stage, not a bug or a sign of misconfiguration. If queries are still returning nothing after Phase 0's policies are in place, that's when it's worth investigating.

## Target Stack

Match Trace's **actual current dependency versions**, not any version number written in prose elsewhere (Trace's own `CLAUDE.md` says "Next.js 15", which is stale — its `package.json` shows 16.2.9). Before scaffolding, check Trace's `package.json` directly if you have access to that repo, or otherwise confirm current stable versions via `npm view <package> version`. As of this guide being written: Next.js 16.2.9 (App Router), React 19.2.4, TypeScript strict (`^5`), `@supabase/supabase-js` ^2.108.2, Tailwind CSS ^4.3.1, shadcn/ui + Lucide React icons, deployed on Vercel.

Do not hardcode these version numbers into this new repo's own `CLAUDE.md` as gospel — write "match Trace's current package.json" as the rule, so the two projects can't silently drift without someone noticing.

## Auth & Security Model (write the RLS policies in Phase 0, before any login screen exists)

This dashboard serves two audiences with different visibility:
- **Admin (Sharan)** — full access across every client
- **Trace clients** — each client's logged-in user sees only rows where `client_id` matches their own

Reconciling this with "client auth ships in Phase 2" above: the RLS *policies* are written in Phase 0 so that no query in this codebase is ever left unscoped from day one. Until real client login exists (Phase 2), those policies simply have no real client JWT to match against, so they correctly return zero rows for every client. Phase 0 verification of the policies (step 5 below) uses a manually-issued test JWT (e.g. minted via the Supabase dashboard or a short script) that carries a `client_id`/`is_admin` claim — not a real login flow, which doesn't exist yet.

Implementation:
1. Every table this dashboard reads gets an RLS policy matching the relevant identity column against a custom JWT claim — but the column differs by table: `clients` is matched on its own `id` column (it IS the tenant, not a row that references one), while `products`, `sessions`, `events`, and `payments` are matched on their `client_id` foreign-key column. Index that matched column on every table if not already indexed — check Trace's migrations if you have access to that repo, otherwise ask Sharan directly rather than guessing.
2. Writing these policies means applying a migration against Trace's *live* Supabase project, which this new repo has no CLI link or service-role access to by default. Ask Sharan how he wants this applied (e.g. pasting SQL into the Supabase dashboard's SQL editor, or a temporarily linked Supabase CLI session) — don't assume `supabase db push` will just work without that access being set up first.
3. UPDATE-capable tables need both `USING` (read/delete check) and `WITH CHECK` (write check) clauses — this dashboard is likely read-only, so most policies only need `USING`, but confirm before assuming write access isn't needed anywhere.
4. Admin access is a **separate bypass claim** (e.g. `is_admin = true` in the JWT), OR'd into each policy's condition alongside the tenant-match check — not the Supabase service-role key used inside application code. The service-role key bypasses RLS entirely and defeats the purpose of testing your own policies; reserve it for one-off admin scripts outside the running app, never inside a request handler.
5. Test every RLS policy via the actual client SDK with a real (or test) user JWT — **not** the Supabase SQL editor, which bypasses RLS and will give you false confidence.
6. Never rely on application-layer `WHERE client_id = ...` filtering as your only defense — a bug in a query is then a tenant data leak. RLS at the database level is the actual guarantee; app-layer filtering is a nice-to-have on top, not a substitute.
7. The `client_id`/`is_admin` JWT claim itself doesn't set itself — mechanically, this is typically wired up via a Supabase custom access token hook (or, on older setups, by writing to a user's `raw_app_meta_data`) at user invite/signup time; research current best-practice for this (per the Workflow Rule below) before implementing it.

## Workflow Rule (write this into `.claude/rules/workflow.md` in the new repo during Phase 0 — this must persist, not just be followed once)

```markdown
# Workflow Rule

Before implementing any new feature or non-trivial UI pattern, browse for current best-practice sources and real examples first (web search / docs / comparable dashboards), then propose the approach with trade-offs before writing code. Don't skip straight to implementation on assumption or training-data memory alone — libraries, patterns, and "current best practice" change fast enough that verifying first is cheaper than redoing work later.
```

## UX/UI Principles (high-level only — do not lock in specifics here)

Use these as guardrails, not a spec: progressive disclosure (show the minimum needed to decide the next action, reveal detail on demand), summary-first (3-5 key metrics before any drill-down view), sidebar navigation once the app has more than ~5 top-level sections. **Do not decide specific chart types, color systems, or component-level visual design from this document** — bring those choices to Sharan directly, in this new project, when you get to building an actual screen.

## Phase 0 — Walking Skeleton + Context Files

Goal: prove the entire stack connects end-to-end, before building any real feature. A walking skeleton is deliberately minimal in features but complete in architecture (Cockburn) — do not skip this by jumping straight to Phase 1's UI.

1. Scaffold a Next.js (App Router) + TypeScript + Tailwind + shadcn/ui project. Deploy an unstyled "hello world" page to Vercel first, to prove the deploy pipeline works before anything else depends on it.
2. Connect to Trace's existing Supabase project using the **anon key only** — get the Supabase project URL *and* the anon key from Sharan (never the service-role key).
3. Write RLS policies + indexes on the matched identity column per table (`id` for `clients`, `client_id` for the rest) per the Auth & Security Model section above.
4. Build a minimal admin-bypass auth stub — not a real login screen yet, just enough to run the app locally acting as admin or as a specific test `client_id`, so Phase 0's proof query can run with either identity.
5. Write and render exactly one real query against real Supabase data on one real deployed page (e.g. "total row count in `payments`"). This is the proof the whole chain works — deploy it and confirm it in a browser before moving on.
6. Generate this repo's own `CLAUDE.md` + `.claude/rules/*.md` using the "What This Project Is," "Trace's Data Model," "Invariants — Never Violate These," "Target Stack," "Auth & Security Model," "UX/UI Principles," and "Workflow Rule" sections of this guide as source content. Keep `CLAUDE.md` itself under ~200 lines — point to files and rules docs rather than repeating everything in prose.

**Phase 0 done when:** a real deployed URL shows real Supabase data, scoped through an actual RLS policy (not a service-role bypass), and the repo has its own `CLAUDE.md` + rules files checked in.

## Phase 1 — Revenue Overview (admin)

Goal: the first real feature, built behind the Phase 0 admin-bypass stub.

Build a view showing: total revenue (sum of `payments.amount` where `status = 'paid'`), revenue broken down per client and per product, conversion rate (count of sessions vs. count of paid payments for the same client/product), and a time-series view of revenue using `paid_at` (not `created_at` — `paid_at` reflects actual payment confirmation timing, `created_at` reflects order creation which may never convert).

**Phase 1 done when:** the revenue view renders real numbers from Trace's live data, verified in a browser as admin, and the numbers are sanity-checked against what you already know about actual sales.

## Phase 2 — Multi-Tenant Client Auth

Goal: replace the Phase 0 admin-bypass stub's client-side with real login, without touching any query logic (because RLS was already built in Phase 0).

1. Add real Supabase Auth (magic link or email/password — your call, magic link is less friction for non-technical client contacts).
2. Map each authenticated client user to a `client_id` via a JWT custom claim (set at signup/invite time).
3. Confirm a logged-in client sees only their own data on the Phase 1 revenue view — verify this in a browser with two different test client accounts, confirming account A never sees account B's numbers.
4. Admin bypass path remains separate and continues to work unchanged.

**Phase 2 done when:** two different test client logins each see only their own scoped data, verified side-by-side in a browser, and admin login still sees everything.

## Phase 3 — Funnel & Attribution Views

Goal: second real feature area, using `events` and the UTM/device columns on `sessions`.

Build: a funnel drop-off view walking `page_load → form_open → form_start → form_submit → payment_open → payment_complete` in order (showing count and drop-off percentage at each step), a UTM/attribution breakdown (by `utm_source`/`utm_campaign` from both the dedicated columns and the `utm_params` jsonb overflow), and a device/network breakdown from `sessions.device_*` and `sessions.network_*` columns.

**Phase 3 done when:** the funnel view correctly reflects the ordered enum (not just an unordered count per event_type), attribution numbers are cross-checked against a known campaign's actual UTM tags, and both views are verified in a browser against real Supabase data.

## Phase 4 — Polish Pass

Goal: production-readiness, not new data views.

Add empty states (a client with zero data should see a helpful message, not a broken chart), loading states for every data fetch, a responsive pass (this will get used on phones by non-technical client contacts), and a navigation structure review (confirm sidebar sections match how many top-level views actually exist by this point — don't over-build nav for views that don't exist yet).

**Phase 4 done when:** every view has been checked in a browser separately with zero data, with slow network throttling on, and on a phone-sized viewport.

## What NOT To Do

- Don't build any TagMango-specific view — TagMango gateway is still stubbed on Trace's side, there's no real data to show yet
- Don't build a read API layer on Trace itself — this was explicitly decided against; the dashboard connects directly to Supabase
- Don't lock in specific chart libraries, color palettes, or detailed visual design from this document — those are Phase-1-and-onward conversations to have directly, informed by browsing current examples first (see Workflow Rule)
- Don't use the Supabase service-role key anywhere in this app's runtime code
- Don't trust `raw_payload` presence/absence as a data-health signal — use `paid_at`

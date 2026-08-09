# Trace Dashboard — Status

Updated at the end of each phase (not each session — see `memory.md` / `/remember` for session-to-session handoff). If this file and `memory.md` disagree, trust this file for anything phase-level and `memory.md` only for very recent in-progress detail.

## Infra inventory

- **Supabase project**: `trace`, ref `ggfkbcdegkpqrjmqjfyw`, region `ap-south-1`. Same project Trace's own backend uses — this dashboard only reads it, via RLS, never the secret/service-role key.
- **Vercel**: project `trace-dashboard` under the `sharan-v-s-projects` team. Production URL: **https://trace-dashboard-alpha.vercel.app**.
- **GitHub**: `sharan-oss/trace-dashboard` (note: this account, not the default machine git identity — see `git config` in this repo, or `docs/adr/` if a mismatch ever recurs).
- **Local repo**: `/Users/sharanv/apps/Trace Dashboard`. Sibling repo `/Users/sharanv/apps/Trace` is Trace's own backend, read-only reference for schema/conventions.
- **Database objects this dashboard owns** (inside Trace's Supabase project — the boundary is a convention, not something the database enforces): the `ads` table, 12 `public.metric_*` functions, the views `v_sessions_attributed`, `v_payments_attributed`, `v_ad_name_resolution`, `v_funnel_by_session`, and the three `overview_*` aggregate RPCs (`20260810100000_overview_aggregate_rpcs.sql`). Slice B adds `ad_accounts`, `ad_insights_daily` and a sync log — which must be named `ad_sync_runs`, because `sync_runs` is now taken by the Razorpay L2 sync log Sharan created directly in the live DB. Migrations are applied through the Supabase MCP connection, which authenticates at management level and **bypasses RLS** — never touch `*_secret_enc` columns through it, and never use it to verify an RLS policy.

## Phase checklist

- [x] **Phase 0 — Walking skeleton** (complete, 2026-07-07)
  - Next.js 16.2.9 / React 19.2.4 / Tailwind v4 / shadcn (`base-nova`) scaffold matching Trace's stack
  - Deployed to the Vercel URL above
  - RLS policies live on `clients`/`products`/`sessions`/`events`/`payments` (`supabase/migrations/20260707000000_dashboard_rls_policies.sql`)
  - Custom Access Token Hook live and enabled (`supabase/migrations/20260707000001_custom_access_token_hook.sql` + Dashboard toggle) — see `docs/adr/001-publishable-key-and-custom-access-token-hook.md`
  - Env-driven dev-identity stub working (`src/lib/auth/dev-identity.ts`) — see `docs/adr/002-env-driven-dev-identity-stub.md` and `docs/adr/003-lazy-session-refresh-for-dev-identity-stub.md`
  - Proof page (`src/app/page.tsx`) verified live: admin JWT saw 132 payments, scoped test-client JWT saw 121, cross-checked against a raw SQL count on the live table
- [x] **Metrics foundation — the data layer under Phases 1 and 3** (complete, merged to `main` 2026-08-09). Not an original phase; it emerged from a live-data profile that found the raw numbers were not trustworthy enough to build a revenue overview on. Slice A of `docs/superpowers/specs/2026-08-09-meta-ads-attribution/`.
  - Vitest harness added (`vitest.config.ts`, `tests/helpers/supabase.ts`) — the project's first tests. 109 passing, run against the live DB through real RLS-scoped JWTs.
  - 11 `public.metric_*` functions: the single definition of every ad/ad set/campaign extraction rule.
  - Four `security_invoker` views: `v_sessions_attributed`, `v_payments_attributed`, `v_ad_name_resolution`, `v_funnel_by_session`.
  - `src/lib/metrics/` — the two separately named metrics and the Unattributed grouping helper.
  - `public.ads` dimension plus a one-time Love School normalisation (see "Temporary things" and the CLAUDE.md note on writes).
  - Live coverage: 9,789 of 10,693 sessions resolve to an ad.
- [x] **Phase 1 — Revenue overview (admin)** (Overview shipped 2026-08-10): app shell (sidebar nav, cookie-backed client switcher — single-client view only, no "all clients" mode), Overview at `/` with KPI tiles (L1/L2 revenue with counts, sessions, conversion rate; Spend/CPA locked "Connect Meta" placeholders), daily L1/L2 revenue chart, top-5 ads table, `?range=` presets. Three `overview_*` aggregate RPCs do all math in Postgres. Design + IA: `docs/superpowers/specs/2026-08-10-dashboard-ia-and-overview-design.md`. Not built (deliberately deferred): per-product breakdown — revisit with the Funnel section.
- [ ] **Phase 2 — Multi-tenant client auth**: real Supabase Auth login (magic link or email/password), replacing the Phase 0 dev-identity stub. Not started. Sequenced **after** Slice B (decided 2026-08-09). It gates anything client-facing, including a self-serve "Connect Meta" flow.
- [ ] **Phase 3 — Funnel & attribution views**: ordered funnel drop-off, UTM/attribution breakdown, device/network breakdown. **Database layer done** (`v_funnel_by_session` with reached-or-beyond semantics, and three-tier attribution on both views); the UI is not started.
- [ ] **Phase 4 — Polish pass**: empty states, loading states, responsive pass, nav review. Not started.

### Meta ads integration (runs alongside the phases above)

Umbrella spec: `docs/superpowers/specs/2026-08-09-meta-ads-attribution/`.

- [x] **Slice A — metrics foundation**: merged 2026-08-09, as above.
- [ ] **Slice B — Meta sync**: three tables, Meta API client, service identity, admin account mapping, first sync. Planned in full at `docs/superpowers/plans/2026-08-09-meta-ads-sync-implementation.md`; branch `slice-b-meta-ads-sync` holds the plan only. Tasks 1–4 need no Meta access; Task 5 is blocked (see Open questions).
- [ ] **Slice C — full sync**: backfill from 2026-06-27, nightly Vercel Cron, creative mirroring into Storage, inactive-ad marking. Not started.
- [ ] **Slice D — Ads section UI**: campaign → ad set → ad drill-down, ROAS/CPA, reconciliation rows. Not started.

(Full phase goals and "done when" criteria: `docs/deliverables/2026-07-06-trace-dashboard-kickoff-guide.md`.)

## Temporary things that must be revisited

- `src/lib/auth/dev-identity.ts` and the `DEV_ROLE`/`DEV_CLIENT_ID` env vars are Phase 0 scaffolding — delete once Phase 2 ships real login (see ADR 002, ADR 003). **The whole test suite authenticates through it**, so deleting it means porting the tests too.
- The two test auth users (`dashboard-admin-test@trace.local`, `dashboard-client-test@trace.local`) live permanently in Trace's `auth.users` table until manually deleted.
- `public.v_payments_attributed_definition_probe()` (migrations `..._140400_*` and `..._140600_*`) exists only so a test can assert that `v_payments_attributed` still joins `v_ad_name_resolution` — that join has zero live rows to test against. Execute is granted to `authenticated` only. Delete it once real name-matched payment rows exist to test against directly.
- `ads` currently holds **only Love School's 67 ads**, hand-seeded from an Ads Manager export. Occultyogis has none, so their sessions resolve ad keys but show no names. The Slice B sync replaces the manual seed; until then, a fresh export seeded the same way is the supported path for a new client.
- The 12 `metric_*` functions have no `set search_path`, so Supabase's `function_search_path_mutable` advisor flags them. Verified non-exploitable (all `SECURITY INVOKER`, all internal calls schema-qualified) but worth silencing so a future real warning is not lost in the noise.
- Migration filenames drift from the versions recorded in `supabase_migrations.schema_migrations`, because migrations are applied through the Supabase MCP rather than the CLI. Pre-existing and project-wide, including `20260707000000_dashboard_rls_policies.sql`.

## Open questions

- **Blocking Slice B's final task — Meta App Review.** Verified against Meta's authorization docs on 2026-08-09: partner-shared ad accounts are "other people's ad accounts", so `ads_read` **Advanced access via App Review** is a hard prerequisite, with Business Verification first. Per-client OAuth does not avoid this — the access level is a property of the app, not of how the token was obtained — and one `ads_read` review unlocks both models. This contradicts `rationale.md`, which claims partner sharing sidesteps App Review; that claim is wrong. Nothing started as of 2026-08-09. Also needed: the agency System User, and at least one client granting it the view-performance task (Occultyogis first — it unlocks names for 2,342 sessions). If the review lead time proves unacceptable, the hedge is a third-party connector that already holds Advanced access.
- Two known attribution limitations, both recorded in the specs: 5 of ~964 paired rows have the session resolving an ad while its payment resolves nothing (upstream — the ad ID sits after a `#` fragment and Trace's payment capture copied only pre-fragment params); and the cross-tenant ad-name guard cannot be proven by test while only one client has rows in `ads`.
- Visual design system (navy ink, off-white canvas, bento grid, semantic colors, Geist/Inter typography) is decided and implemented — see `docs/superpowers/specs/2026-08-08-visual-design-system.md` and `docs/superpowers/plans/2026-08-08-visual-design-system-implementation.md`. Chart library choice (shadcn charts on Recharts) is also decided per that spec. Still open: the chart/data-viz categorical color palette for multi-series charts, and dark mode — both explicitly deferred in the spec.

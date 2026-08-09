# Trace Dashboard

## What This Is

Analytics dashboard for **Trace**, a multi-tenant payment + attribution platform (separate repo: `sharan-oss/trace`, live at `https://trace-it-app.vercel.app`). Trace collects payments (Razorpay/TagMango), UTM attribution, and behavioral funnel data from client landing pages, storing everything in Supabase. This dashboard **reads** that data and never touches Trace's payment/webhook logic.

**On writing to Trace's tables — state this precisely.** Application code never writes to `clients`, `products`, `sessions`, `events` or `payments`; their RLS policies are `USING`-only, so a write is refused outright. The narrow exception is a one-off admin-run migration with Sharan's explicit sign-off, which happened exactly once: the 2026-08-09 Love School normalisation added nullable `campaign_id`/`adset_id`/`ad_id` columns to `sessions` and `payments` and backfilled them (`supabase/migrations/20260809130200_*` and `..._130300_*`, null-fill only and idempotent). Tables this dashboard owns — `ads` and the Slice B sync tables — are different: they carry deliberate `WITH CHECK` write policies gated on `is_admin`.

Two audiences:
- **Admin (Sharan)** — sees data across all clients
- **Trace's clients** — each sees only their own data, once client auth ships in Phase 2

Full project data model: `.claude/rules/data-model.md`. Hard rules: `.claude/rules/invariants.md`. Auth/RLS mechanics: `.claude/rules/auth-security.md`. Research-before-building rule: `.claude/rules/workflow.md`.

## Target Stack

Match Trace's (`sharan-oss/trace`) **current `package.json`** — don't hardcode version numbers here, they drift. As of Phase 0 setup: Next.js 16.2.9 (App Router), React 19.2.4, TypeScript strict, `@supabase/supabase-js` ^2.108.2, Tailwind CSS v4, shadcn/ui (`base-nova` preset, neutral base) + Lucide React (icons ≤ 18px), deployed on Vercel. Testing is **Vitest** in a Node environment (`vitest.config.ts`), added 2026-08-09 — it was not part of the original Phase 0 stack.

**Visual design (2026-08-10):** the dashboard adopts Trace's own dark glass design system 1:1 — canonical recipes in `docs/design-system/trace-design-system.md`, dashboard-specific extensions in `docs/superpowers/specs/2026-08-10-visual-design-system-v2-dark.md`. Dark-only, alpha-based elevation (**never shadows**), indigo as the only action/highlight color, emerald/red strictly for status, slate text ladder, tokens in `globals.css` (never hardcode palette values in components).

## Auth

Publishable key + RLS only — never the secret/service-role key (see `.claude/rules/auth-security.md`). No real login yet; Phase 0 uses an env-driven dev-identity stub (`src/lib/auth/dev-identity.ts`).

## Data Layer

Don't query the raw tables for anything attribution- or metrics-shaped — a normalized read layer already exists and encodes rules the raw data does not.

- **`public.metric_*` functions** are the single definition of every extraction rule (ad, ad set and campaign identifiers out of URL query strings and `utm_params`). Compose them; never re-derive a regex inline. They are pure and RPC-callable, so they can be unit-tested directly.
- **Views**: `v_sessions_attributed` and `v_payments_attributed` (three-tier attribution — ad, then ad set, then campaign — plus normalized UTM source and test-row marking), `v_ad_name_resolution` (the campaign-scoped unique-ad-name rule, shared by both so they cannot drift), and `v_funnel_by_session` (one row per session, stages meaning "reached this stage or any later one"). All are `security_invoker = true` so base-table RLS applies — a view without it is a tenant data leak.
- **`src/lib/metrics/`** holds the two separately named metrics and the Unattributed grouping helper. Never label either metric simply "conversion".
- **`public.ads`** is the dashboard-owned Meta ad dimension; the views join it for names and hierarchy at read time.

Design and the live-data evidence behind these rules: `docs/superpowers/specs/2026-08-09-meta-ads-attribution/`. Where that spec and `docs/superpowers/plans/2026-08-09-metrics-foundation-implementation.md` disagree, the plan's live-verified measurements win — several spec claims were measured wrong and are corrected there.

## UX/UI Principles

Guardrails, not a spec: progressive disclosure (show the minimum needed to decide the next action, reveal detail on demand), summary-first (3-5 key metrics before any drill-down view), sidebar navigation once the app has more than ~5 top-level sections. Don't lock in chart types, color systems, or component-level visual design without first bringing options to Sharan (see `.claude/rules/workflow.md`).

## Commands
- `npm run dev` — start dev server
- `npm run typecheck` — type check
- `npm test` — run the Vitest suite once
- `npm run test:watch` — Vitest in watch mode

Tests run against the **live** Supabase project through real RLS-scoped JWTs — there is no mock database and no fixture seed. So: they must stay strictly read-only against Trace's core tables, and they must assert relationships and invariants rather than absolute row counts, because rows arrive while the suite runs. `tests/helpers/supabase.ts` provides `adminClient()`, `clientClient()`, `countRows()` and `expectStableEqualCounts()`. Per `.claude/rules/auth-security.md`, RLS is verified through the client SDK, never the Supabase SQL editor, which bypasses it.

## Project Phases & Status

**Read `docs/STATUS.md` first in any new session** — it has the current phase, infra inventory (Supabase/Vercel/GitHub), and known-temporary things. Full phase breakdown and "done when" criteria: `docs/deliverables/2026-07-06-trace-dashboard-kickoff-guide.md`. System overview/data flow: `docs/architecture.md`. Why non-obvious decisions were made: `docs/adr/`.

@.claude/rules/data-model.md
@.claude/rules/invariants.md
@.claude/rules/auth-security.md
@.claude/rules/workflow.md

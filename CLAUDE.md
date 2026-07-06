# Trace Dashboard

## What This Is

Analytics dashboard for **Trace**, a multi-tenant payment + attribution platform (separate repo: `sharan-oss/trace`, live at `https://trace-it-app.vercel.app`). Trace collects payments (Razorpay/TagMango), UTM attribution, and behavioral funnel data from client landing pages, storing everything in Supabase. This dashboard **reads** that data — it does not write to Trace's core tables, and never touches Trace's payment/webhook logic.

Two audiences:
- **Admin (Sharan)** — sees data across all clients
- **Trace's clients** — each sees only their own data, once client auth ships in Phase 2

Full project data model: `.claude/rules/data-model.md`. Hard rules: `.claude/rules/invariants.md`. Auth/RLS mechanics: `.claude/rules/auth-security.md`. Research-before-building rule: `.claude/rules/workflow.md`.

## Target Stack

Match Trace's (`sharan-oss/trace`) **current `package.json`** — don't hardcode version numbers here, they drift. As of Phase 0 setup: Next.js 16.2.9 (App Router), React 19.2.4, TypeScript strict, `@supabase/supabase-js` ^2.108.2, Tailwind CSS v4, shadcn/ui (`base-nova` preset, neutral base) + Lucide React, deployed on Vercel.

## Auth

Publishable key + RLS only — never the secret/service-role key (see `.claude/rules/auth-security.md`). No real login yet; Phase 0 uses an env-driven dev-identity stub (`src/lib/auth/dev-identity.ts`).

## UX/UI Principles

Guardrails, not a spec: progressive disclosure (show the minimum needed to decide the next action, reveal detail on demand), summary-first (3-5 key metrics before any drill-down view), sidebar navigation once the app has more than ~5 top-level sections. Don't lock in chart types, color systems, or component-level visual design without first bringing options to Sharan (see `.claude/rules/workflow.md`).

## Commands
- `npm run dev` — start dev server
- `npm run typecheck` — type check
- `npm run dev:session` — refresh Phase 0 dev-identity test JWTs (see `.claude/rules/auth-security.md`)

## Project Phases

See `2026-07-06-trace-dashboard-kickoff-guide.md` for the full phase breakdown (Phase 0 walking skeleton → Phase 1 revenue overview → Phase 2 multi-tenant client auth → Phase 3 funnel/attribution → Phase 4 polish). Currently in Phase 0.

@.claude/rules/data-model.md
@.claude/rules/invariants.md
@.claude/rules/auth-security.md
@.claude/rules/workflow.md

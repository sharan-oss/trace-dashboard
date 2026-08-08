# Memory — Trace Dashboard

Last updated: 2026-08-08

## What was built

**Phase 0 (prior session, still current):** Auth/RLS scaffold, Custom Access Token Hook, env-driven dev-identity stub. `src/lib/auth/dev-identity.ts`'s `getDevJwt(role)` signs in lazily via `signInWithPassword` and caches the session JWT in memory per role, auto-refreshing ~60s before expiry — no more manual `npm run dev:session` / Vercel env re-upload. See ADR 003.

**This session — Visual design system (spec + full implementation, merged to `main`):**
- `docs/superpowers/specs/2026-08-08-visual-design-system.md` — the approved design spec (navy ink, off-white canvas, bento grid, semantic colors, typography, chart-library choice).
- `docs/superpowers/plans/2026-08-08-visual-design-system-implementation.md` — the 5-task implementation plan.
- `src/app/globals.css` — navy-ink tokens (`--foreground`/`--primary`), off-white canvas, hairline borders (ink @ 10% alpha), semantic `--success`/`--warning`/`--danger` pairs (WCAG AA-verified), `--secondary`/`--muted`/`--accent`/`--muted-foreground` (added during implementation, not in the original spec — backfilled after), `--radius: 0.5rem`.
- `src/app/layout.tsx` — added Inter font loader; `font-sans`→Inter, `font-heading`→Geist Sans, `font-mono`→Geist Mono (also fixed a pre-existing circular CSS-variable bug where `--font-sans` referenced itself).
- `src/components/ui/status-badge.tsx` — `StatusBadge({status, label, className})`, pill-shaped (`rounded-full`, a deliberate deviation from the spec's original `rounded-lg` guidance), icon + text always paired (never color alone).
- `src/components/ui/bento-tile.tsx`, `src/components/ui/bento-grid.tsx` — bento layout primitives, no shadows anywhere, hairline borders only.
- `src/app/page.tsx` — Phase 0 RLS-proof page reskinned with the above; data-fetching logic (`getPaymentsCount`) unchanged.
- `docs/STATUS.md` — updated: design system marked decided/implemented, Phase 1 checklist notes the prerequisite is done.

## Decisions made

- ADR 003 (Phase 0): lazy in-memory `signInWithPassword` caching over `@supabase/ssr` cookie-refresh — avoids duplicating Phase 2 work.
- Monochrome-first design system: one deep navy ink color (`#101C34`, not pure black) does double duty as structural ink AND brand color; color elsewhere is reserved entirely for semantic status (success/warning/danger), never decoration.
- No shadows anywhere; hairline borders (derived from ink, not generic gray) are the only tile-separation mechanism — both explicit, deliberate rejections of the "soft card" SaaS-template look.
- Typography: Geist Sans for headers/KPI numbers, Inter for body/labels (better at small dense-dashboard sizes), Geist Mono reserved for tabular data-table figures (not the hero KPI number).
- Chart library: shadcn's own chart components (Recharts-based) — inherits the design-token system for free instead of running a second component philosophy (Tremor) alongside shadcn.
- Two implementation-time deviations from the original spec, confirmed by Sharan rather than reverted: `StatusBadge` uses `rounded-full` (pill) instead of the spec's `rounded-lg`; four extra surface tokens (`--secondary`/`--muted`/`--accent`/`--muted-foreground`) were added because shadcn's component system requires those slots — both backfilled into the spec doc as the record of truth.
- `docs/STATUS.md` (durable, phase-level) wins over `memory.md` (session handoff) if they ever disagree.

## Problems solved

- Phase 0: dev-identity stub required manual hourly JWT refresh — fixed via lazy in-memory session caching (see ADR 003).
- This session: final whole-branch review caught `--muted-foreground` failing WCAG AA (4.44:1 on canvas, needed 4.5:1) — the spec's own proposed 60% alpha value was never actually contrast-checked until implementation; fixed by raising to 65% alpha (~5.22:1).

## Current state

- Phase 0 complete and verified (auth, RLS, dev-identity, proof page).
- Visual design system complete, implemented via subagent-driven-development (5 tasks, all task-reviews clean, final whole-branch review clean after one fix round), merged to `main` (commit `07b7476`). `npm run typecheck` and `npm run build` both pass on `main`.
- Repo: `sharan-oss/trace-dashboard`. Worktree/branch used for this work (`worktree-visual-design-system`) has been merged and deleted — nothing left to clean up.

## Next session starts with

Phase 1 — Revenue Overview (admin): total revenue (sum of `payments.amount` where `status = 'paid'`), per-client/per-product breakdown, conversion rate (sessions vs. paid payments), `paid_at`-based time series. Build using the now-complete bento tile/StatusBadge/token system — no more open design-system questions blocking this.

## Open questions

- Chart/data-viz categorical color palette for multi-series charts (UTM sources, funnel steps) — explicitly deferred to when the first real chart gets built in Phase 1, must stay visually distinct from the 3 semantic status colors.
- Dark mode companion palette — explicitly deferred, light-mode-first only for now.
- Exact bento tile sizing/breakpoint rules — left to Phase 1 implementation rather than fully specified in the spec.

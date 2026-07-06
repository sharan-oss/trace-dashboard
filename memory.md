# Memory — Trace Dashboard: Phase 0 + Durable Context Docs

Last updated: 2026-07-07

## What was built

This session picked up right after Phase 0 completion and added durable documentation (Phase 0 itself was built and saved to memory in the prior session — see `docs/STATUS.md` for the full Phase 0 checklist, not repeated here):

- `docs/architecture.md` — identity → claims → RLS data flow end to end, Phase 0 vs Phase 2 comparison.
- `docs/adr/001-publishable-key-and-custom-access-token-hook.md` — ADR for why publishable/secret keys + Custom Access Token Hook were used instead of legacy anon key + hand-signed JWTs.
- `docs/adr/002-env-driven-dev-identity-stub.md` — ADR for why the Phase 0 dev-identity stub is env-driven and shares Phase 2's real claim-injection mechanism.
- `docs/STATUS.md` — durable, phase-level status tracker (infra inventory, phase checklist, temporary things to revisit, open questions). This is the new canonical "where are we" doc — committed to git, unlike `memory.md` which gets overwritten every session.
- Moved `2026-07-06-trace-dashboard-kickoff-guide.md` → `docs/deliverables/` to match the `sharan-oss/trace` repo's own `docs/` convention (`docs/architecture.md`, `docs/adr/NNN-title.md`, `docs/deliverables/`).
- `CLAUDE.md` updated to point fresh sessions at `docs/STATUS.md` first, then the ADRs/architecture doc as needed.
- Committed and pushed (2 commits: Phase 0 work from prior session, then this session's docs).

## Decisions made

- Documentation structure deliberately mirrors the existing `Trace` repo's convention (`docs/architecture.md`, `docs/adr/`, `docs/deliverables/`) for cross-repo consistency, rather than inventing a new structure.
- `docs/STATUS.md` (committed, updated per-phase) is the durable status doc; `memory.md` (via `/remember`, overwritten per-session) is only for very recent session-to-session handoff. If they ever disagree, `docs/STATUS.md` wins for anything phase-level.
- Confirmed via web research (Claude Code docs, HackerNoon, AGENTS.md spec, ADR-pattern sources) that this structure — short root context file linking out to ADRs and a status doc — matches how experienced developers structure agent context in 2026.

## Problems solved

Nothing new this session — this was a research-and-document session, no bugs encountered.

## Current state

- Phase 0 is complete and verified (see `docs/STATUS.md` for details — admin/test-client RLS scoping confirmed live on the deployed Vercel URL).
- Durable context docs are in place and pushed. A fresh Claude session can now read `CLAUDE.md` → `docs/STATUS.md` → ADRs/architecture and understand the project without this conversation.
- Repo: `sharan-oss/trace-dashboard`, 3 commits on `main`, all pushed.

## Next session starts with

Phase 1 — Revenue Overview (admin): total revenue (sum of `payments.amount` where `status = 'paid'`), per-client/per-product breakdown, conversion rate (sessions vs. paid payments), and a `paid_at`-based time series. Build behind the Phase 0 admin-bypass stub. Per the Workflow Rule, browse current best-practice dashboard/chart examples before picking a chart library or layout — this is explicitly not decided yet.

## Open questions

- Whether to keep manually refreshing the Phase 0 dev-session JWTs (`npm run dev:session`, ~1hr expiry) or switch the dev-identity stub to sign in per-request instead — worth deciding before Phase 1 adds more pages that depend on it. (Tracked in `docs/STATUS.md` too.)
- Chart library, color system, and visual design for Phase 1 — not decided, bring options to Sharan first.

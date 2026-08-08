# Visual Design System — Trace Dashboard

Date: 2026-08-08
Status: Approved by Sharan (brainstorm session), pending Phase 1 implementation

## Why

Phase 0 shipped the walking skeleton (auth, RLS, scaffold) with no visual design decided —
`.claude/rules/workflow.md` and `docs/STATUS.md` both explicitly deferred chart library,
color system, and visual design rather than defaulting to whatever a fresh session might
assume. This spec locks in that system before Phase 1 (Revenue Overview) starts writing UI
code, based on research into current (Aug 2026) top-tier SaaS/dashboard design practice —
not on training-data memory of what "modern SaaS" looked like previously.

Goal: an analytics dashboard that reads as premium, current, and "young Silicon Valley
startup" rather than enterprise-admin-panel-generic — while staying clean enough that
revenue/funnel/attribution data (the actual content) stays legible and trustworthy.

## Design principles

1. **Monochrome-first, color-for-meaning-only.** A single ink color carries all structural
   hierarchy (text, buttons, active states). Color is reserved entirely for semantic status
   (success/warning/danger) — never used decoratively. This follows the pattern common to
   Stripe/Linear/Vercel: one color used sparingly beats five colors used everywhere.
2. **Bento grid layout.** Modular tiles of varying size, one data point or chart per tile
   (KPI number, chart, status list). Scannable at a glance — a non-expert should be able to
   read the dashboard's health in a few seconds, the way Payhawk's expense dashboard reads
   spend health in ~4 seconds.
3. **Flat, not skeuomorphic.** No shadows. Tile separation comes from hairline borders, not
   elevation effects — shadows read as dated/template-y at this point.
4. **Light-mode-first.** Dark mode is an explicit later pass, not designed in this spec.
5. **Typography as the primary carrier of "premium," not color.** Tight, purposeful type
   choices matter more to the premium feel than the palette does.

## Color tokens

### Structural (ink / canvas / border)

| Token | Value | Usage |
|---|---|---|
| `--ink` | `#101C34` | Body text, primary buttons, active nav/tab state, chart axis lines. Deep desaturated slate-navy — deliberately not literal navy (`#000080`, reads as dated "navy chrome") and not pure black (halation/harshness against light backgrounds). |
| `--canvas` | `#FAFAFA` | Page background. Off-white, not pure white — reduces harshness, gives tiles something to sit visibly above. |
| `--tile-bg` | `#FFFFFF` | Bento tile background (one step lighter than canvas). |
| `--border` | `rgba(16, 28, 52, 0.10)` (flat equivalent ≈ `#E2E5EB`) | 1px hairline border on every tile. Derived from the ink color rather than a generic gray, so structure still carries the brand undertone. |

**Contrast check** (WCAG 2.2, computed): `--ink` on `--canvas` = **16.26:1**, `--ink` on
`--tile-bg` = **16.97:1** — both pass AA and AAA for text by a wide margin. The border
token is a structural/decorative divider, not text, so the 4.5:1 text-contrast requirement
doesn't apply to it; WCAG's non-text boundary guidance (1.4.11, ~3:1) is also not required
for purely decorative dividers, so the low-contrast hairline is intentional, not a defect.

### Semantic (status only — always paired with a Lucide icon + text label, never color alone)

| Role | Text | Background tint | Contrast (text vs. own tint) | Contrast (text vs. canvas) |
|---|---|---|---|---|
| Success (paid / positive trend) | `#047857` | `#ECFDF5` | 5.21:1 (AA pass) | 5.25:1 (AA pass) |
| Warning (pending / funnel stall) | `#B45309` | `#FFFBEB` | 4.84:1 (AA pass) | 4.81:1 (AA pass) |
| Danger (failed / broken funnel step) | `#B91C1C` | `#FEF2F2` | 5.91:1 (AA pass) | 6.20:1 (AA pass) |

All three pass WCAG AA (4.5:1) for normal text in both contexts (as a badge on its own tint,
and as plain text directly on canvas). None reach AAA (7:1) — acceptable, AA is the bar this
project targets.

### Explicitly deferred (not part of this spec)

- **Chart/data-viz categorical palette** for multi-series charts (UTM source breakdown,
  funnel-by-step). Must be visually distinct from the three semantic colors above so a
  chart series (e.g. "Instagram" as green) is never misread as a status ("success"). To be
  designed alongside the first real chart in Phase 1 implementation, informed by whichever
  chart library is used (see below) and needs a colorblind-safe check at that point.
- **Dark mode companion palette.** Light-first only, per direction. Revisit post-Phase 1.

## Typography

| Role | Typeface | Rationale |
|---|---|---|
| Headers / KPI numbers | **Geist Sans** | Tighter, more mechanical figures — makes the large numbers in each bento tile (revenue, conversion %) look intentional rather than templated. |
| Body / labels / table rows / axis labels / timestamps | **Inter** | Taller x-height holds up better at the small sizes a dense dashboard uses constantly; Geist gets slightly cramped at those sizes. |
| Tabular figures (amounts, percentages, dates wherever alignment matters) | **Geist Mono** | Purpose-built for tabular numerals; keeps columns of numbers visually aligned. |

This Geist-headers/Inter-body/Geist-Mono-numerals combination is the pairing current
research identifies as standard for dense, data-heavy dashboards (AI tools, dev tools,
fintech) — not an arbitrary pick.

## Layout

- **Grid**: bento — variable tile sizes (e.g. 1x1, 2x1, 2x2) on a consistent column grid,
  not a uniform card grid. Larger tiles for the timeseries/funnel views, smaller tiles for
  single KPIs.
- **Spacing**: 4px base unit (`4, 8, 12, 16, 24, 32, 48, 64`), consistent with Tailwind's
  default scale. Gutters between tiles: 16–24px.
- **Radius**: tiles use a soft-but-not-heavy corner radius (`12px` / Tailwind `rounded-xl`);
  inner elements (badges, buttons) use a slightly tighter radius (`8px` / `rounded-lg`) so
  tiles read as the "outer" container.
- **No shadows anywhere.** Hairline borders (see color tokens) are the only separation
  mechanism.
- Exact per-component sizing (tile min/max widths, responsive breakpoints) is left to
  Phase 1 implementation rather than fully specified here — this doc fixes the *system*,
  not every pixel.

## Chart library

**Decision: shadcn/ui's own chart components (built on Recharts).** Given shadcn/ui is
already the fixed component system (`CLAUDE.md`), its chart components inherit the design
token system for free (they're themed via the same CSS variables as the rest of shadcn).
Tremor was considered — it's purpose-built for analytics KPI/tracker patterns — but is a
separate styling system on Radix, not shadcn, and adopting it alongside shadcn/ui would mean
maintaining two component philosophies in one app. Recommendation: use shadcn charts for
consistency, and borrow Tremor's *layout patterns* (KPI tile composition, trend indicators)
as inspiration without adopting the library itself.

## Rejected directions (kept for record)

- Three single-accent-color pitches — Indigo/Violet Precision, Mint/Teal Fresh Fintech,
  Violet→Fuchsia Pop — were proposed and researched first, each pairing one saturated accent
  hue with a neutral canvas. None were chosen; the conversation converged instead on
  monochrome-first + navy ink + semantic-only color, which does the "distinctive but
  restrained" job the accent-color pitches were aiming for without needing a decorative hue.
- **Near-black neutral ink** (gray-black, no color undertone) — superseded by navy ink,
  which better reflects the "cool colors" / fintech-appropriate direction while still
  functioning as a near-black at a glance.
- **Tone-stepped canvas** (tile separation via background lightness alone, no border) —
  considered and rejected in favor of hairline borders, which read as more defined/bento-like
  than a pure tone-step for this use case.
- **Soft shadows** for tile elevation — rejected as dated/template-y.

## Open questions for Phase 1 implementation (not blocking this spec)

- Chart categorical palette (see "Explicitly deferred" above).
- Exact bento tile sizing/breakpoint rules.
- Whether any secondary/tertiary text tone (e.g. a muted gray for timestamps/captions) is
  needed alongside `--ink` at full opacity — likely yes, propose `--ink` at reduced opacity
  (e.g. 60%) rather than a separate gray token, to stay consistent with the single-ink-color
  principle. To be confirmed against real content during implementation.

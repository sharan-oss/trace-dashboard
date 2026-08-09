# Visual Design System v2 — Dark Glass (Trace-aligned)

Date: 2026-08-10
Status: Approved by Sharan, implemented on `main` the same day.
Supersedes: `2026-08-08-visual-design-system.md` (light canvas, monochrome, color-for-status-only).

## The decision

The dashboard adopts **Trace's own admin design system 1:1** so both apps read
as one product family. The canonical reference is
[`docs/design-system/trace-design-system.md`](../../design-system/trace-design-system.md)
— extracted verbatim from Trace's live code by Sharan. In one line: a dark
*glass console* — slate-950/900 gradient canvas, frosted white-alpha surfaces,
indigo as the only action color, emerald/red reserved for status, compact
typography, **no shadows** (elevation = opacity).

Implementation route: the doc's §6 **option 2** — this repo's shadcn
components stay token-driven, and `src/app/globals.css` remaps every token
slot onto the Trace palette (values only; token names unchanged). Dark-only:
there is no `.dark` class, no light mode, and `color-scheme: dark` is set on
`html`.

## What carried over from v1

- **No shadows, ever.** v1 said it for flatness; v2's mechanism is
  alpha-elevation, but the rule is identical. `grep -rn "shadow-" src/` must
  stay empty.
- The bento grid and tile-size variants.
- **Geist Mono as a real loaded mono font** for tabular figures, ids, and
  slugs (`font-mono tabular-nums` on every numeric table cell). Trace itself
  falls back to the system mono stack; we keep the better setup.
- Semantic color never stands alone — always icon + text label
  (`StatusBadge`).

## What changed

- **Palette**: full dark remap in `globals.css :root` (slate-950 canvas +
  gradient body, white/5 translucent cards with `backdrop-blur-md`, white/10
  hairlines, indigo-600 primary / indigo-300 accent text, slate text ladder).
- **Fonts**: Inter dropped. Geist is `--font-sans` (body and headings;
  `--font-heading` aliases it so existing classes still work).
- **Radius**: `--radius: 0.625rem` (doc §2.5/§6) — buttons/inputs
  `rounded-lg`, cards `rounded-2xl`.
- **StatusBadge**: restyled to doc §3.6 — lucide icon + colored text, no
  filled pill. The v1 iconsax `variant="Bulk"` exception is retired and
  `iconsax-react` removed from dependencies.
- **Color-for-status-only relaxed**: indigo is now the intentional
  highlight/action color (hero tiles, active states, the L2 chart line and
  table column). Emerald/red remain status-only; amber is held in tokens as
  the warning pair (Trace has no warning color — dashboard extension).

## Dashboard-specific extensions (not in the Trace doc)

Trace's admin has no metrics surfaces, so these extend the system in its
spirit:

- **KPI tile anatomy** (`src/components/overview/kpi-tile.tsx`): eyebrow
  label (doc recipe: `text-xs font-semibold text-slate-400 uppercase
  tracking-wider`) + icon chip (`bg-white/5 border border-white/10
  rounded-lg p-2`, lucide 15, `text-indigo-400`) on top; value at
  `text-4xl font-bold text-white tabular-nums` — deliberately larger than
  the doc's `text-xl` "big number", which is for dense admin cards.
- **Hero tiles** (L1/L2 revenue): `border-indigo-500/30` +
  `bg-indigo-500/6` wash.
- **Locked (Meta-derived) tiles**: ghost dash `text-white/25`, lock icon
  chip in `text-slate-600`, "Connect Meta to unlock" caption — dormant, not
  broken; never fake zeros. Same for the chart's Spends/CPA tabs.
- **Chart 2-series palette (decided)**: `--chart-1` = indigo-400, the hero
  line = **L2 revenue** (the acquisition story) at 2px; `--chart-2` =
  slate-400 baseline = L1 at 1.5px. `--chart-3..5` are reserved slate steps.
  The >2-series categorical palette remains the only deferred color
  decision.
- **Tooltips/popovers are SOLID** (`--popover` = slate-900, no blur) —
  translucency is for surfaces over the canvas, not for floating content
  over varied backgrounds.

## Contrast notes (computed)

- slate-400 (`oklch(0.704 0.04 256.788)`) on slate-950 ≈ 7.4:1 — AA for all
  sizes; the default secondary text.
- slate-500 ≈ 4.0:1 — fails AA for body text; reserved for tertiary
  hints/timestamps/slugs and disabled/ghost states only.
- White and indigo-300 on all surfaces ≥ AA.

## Verified on ship day

Playwright screenshots at 1440px and 375px, dropdown-open and tooltip-hover
states, zero console errors; `npm run typecheck` / `npm test` (163) /
`npm run build` green; `grep` clean for `shadow-`, `dark:`, and `iconsax`.

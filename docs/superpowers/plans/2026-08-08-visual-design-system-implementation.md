# Visual Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the approved visual design system (`docs/superpowers/specs/2026-08-08-visual-design-system.md`) into real Tailwind/shadcn theme tokens, typography, and a first set of bento-grid primitives, then prove it end-to-end by reskinning the existing Phase 0 proof page.

**Architecture:** This is a token-and-primitives change, not a new feature — all values flow from CSS custom properties in `src/app/globals.css` (already the shadcn `base-nova` convention: `--X` / `--X-foreground` pairs consumed by Tailwind's `@theme inline` block), so shadcn components already in the repo (`Button`) re-theme automatically with no code changes. Two new component primitives (`BentoTile`, `BentoGrid`) and one semantic component (`StatusBadge`) get added following the existing `cva` + `cn` pattern already used by `src/components/ui/button.tsx`. The existing RLS proof page (`src/app/page.tsx`) gets reskinned with these, both to prove the system compiles/renders correctly and to keep Phase 0's existing verification value (admin vs. scoped client payment counts) intact — nothing about its Supabase/auth logic changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4 (`^4.3.1`), shadcn/ui (`base-nova` preset, neutral base, `cssVariables: true`), `class-variance-authority` `^0.7.1`, `clsx`/`tailwind-merge` (via existing `cn()` in `src/lib/utils.ts`), `lucide-react` `^1.21.0`.

**Testing approach:** This repo has no test runner configured (`package.json` scripts are `dev`/`build`/`start`/`typecheck` only) — this is a visual/token-driven change, not logic, so per `CLAUDE.md`'s own rule ("Type checking and test suites verify code correctness, not feature correctness — if you can't test the UI, say so explicitly"), each task is verified by `npm run typecheck` plus a concrete, specific visual check in the browser via `npm run dev` — not a fabricated test suite. Do not add a test framework as part of this plan; that's out of scope.

## Global Constraints

- Stack is fixed, do not change versions: Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4 `^4.3.1`, shadcn/ui `base-nova` preset / neutral base, Lucide React (`.claude/CLAUDE.md`).
- Ink color (text, primary buttons, active states, chart axis lines): `#101C34` → `oklch(0.229 0.050 262.971)`.
- Canvas (page background): `#FAFAFA` → `oklch(0.985 0 0)`.
- **No shadows anywhere** — explicitly rejected in the design spec.
- Tile separation is hairline borders only, derived from the ink color at low opacity, not generic gray.
- Semantic color (success/warning/danger) is used for status only, never decoration, and is always paired with a Lucide icon + text label — never color alone (spec's accessibility requirement).
- Typography: **Geist Sans** for headers/KPI numbers, **Inter** for body/labels/table rows/timestamps, **Geist Mono** for tabular figures where column alignment matters (data tables) — not the same thing as the hero KPI number, which stays Geist Sans per the spec's explicit table.
- Bento grid layout, light-mode-first. Dark mode is explicitly out of scope for this plan — do not add `.dark` values for any new token.
- Chart/data-viz categorical palette is explicitly deferred (spec) — do not touch `--chart-1` through `--chart-5` in this plan.
- `--destructive` (existing shadcn token) is untouched — it's a separate, interaction-intent token (shadcn's built-in "destructive action" button/dialog variant), conceptually distinct from the new `--danger` status token, and out of scope since this dashboard is read-only (`.claude/rules/invariants.md`: never writes to Trace's tables) so no destructive-action UI exists yet.
- Never touch `*_secret_enc` columns, never use the Supabase secret/service-role key — unrelated to this plan's files, but a standing project rule (`.claude/rules/invariants.md`, `.claude/rules/auth-security.md`).

---

## Task 1: Typography tokens — Inter font + fix font-family wiring

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css:10-12`

**Interfaces:**
- Produces: CSS custom properties `--font-inter`, `--font-geist-sans`, `--font-geist-mono` (already existed) set on `<html>`; Tailwind theme keys `font-sans` (→ Inter), `font-heading` (→ Geist Sans), `font-mono` (→ Geist Mono, unchanged) available as utility classes (`font-sans`, `font-heading`, `font-mono`) to every later task.

- [ ] **Step 1: Add the Inter font loader to the root layout**

In `src/app/layout.tsx`, add an `Inter` import next to the existing `Geist`/`Geist_Mono` import and a matching loader:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Fix the font-family theme mapping in `globals.css`**

`src/app/globals.css` currently has a circular/unset mapping (`--font-sans: var(--font-sans)` never resolves to an actual font, and `--font-heading` just copies whatever `--font-sans` is). Replace lines 10-12:

```css
  --font-sans: var(--font-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-sans);
```

with:

```css
  --font-sans: var(--font-inter);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-geist-sans);
```

(`html { @apply font-sans; }` further down the file already applies this as the document default — no change needed there, it now correctly resolves to Inter.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Visual check**

Run: `npm run dev`, open `http://localhost:3000`. Open browser DevTools, inspect the `<h1>` — computed `font-family` should start with `Inter`. Inspect `<html>` — should carry three font variable classes (`__variable_...` × 3 from next/font).

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "Add Inter font and fix font-sans/font-heading token wiring"
```

---

## Task 2: Color tokens — navy ink, off-white canvas, hairline borders, semantic colors

**Files:**
- Modify: `src/app/globals.css:7-84` (the `@theme inline` block's color mappings and the light-mode `:root` block)

**Interfaces:**
- Produces: Tailwind utility classes `bg-background`, `text-foreground`, `bg-card`, `bg-primary`/`text-primary-foreground`, `bg-secondary`, `bg-muted`/`text-muted-foreground`, `bg-accent`, `border-border`, `bg-success`/`text-success-foreground`, `bg-warning`/`text-warning-foreground`, `bg-danger`/`text-danger-foreground`, `rounded-lg`/`rounded-xl` (via `--radius`) — all consumed by Task 3, 4, 5 and by the existing `src/components/ui/button.tsx` (no changes needed there, it already reads these same variable names).

- [ ] **Step 1: Register the three new semantic color pairs in the `@theme inline` block**

In `src/app/globals.css`, inside the `@theme inline { ... }` block (currently lines 7-49), add these six lines anywhere among the other `--color-*` mappings (e.g. directly after `--color-card: var(--card);`):

```css
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-danger: var(--danger);
  --color-danger-foreground: var(--danger-foreground);
```

- [ ] **Step 2: Replace the light-mode `:root` color and radius values**

Replace the existing `:root { ... }` block (lines 51-84) with:

```css
:root {
  --background: oklch(0.985 0 0);
  --foreground: oklch(0.229 0.050 262.971);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.229 0.050 262.971);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.229 0.050 262.971);
  --primary: oklch(0.229 0.050 262.971);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.96 0.010 262.971);
  --secondary-foreground: oklch(0.229 0.050 262.971);
  --muted: oklch(0.96 0.010 262.971);
  --muted-foreground: oklch(0.229 0.050 262.971 / 60%);
  --accent: oklch(0.94 0.014 262.971);
  --accent-foreground: oklch(0.229 0.050 262.971);
  --destructive: oklch(0.577 0.245 27.325);
  --success: oklch(0.979 0.021 166.113);
  --success-foreground: oklch(0.508 0.105 165.612);
  --warning: oklch(0.987 0.021 95.277);
  --warning-foreground: oklch(0.555 0.146 48.998);
  --danger: oklch(0.971 0.013 17.380);
  --danger-foreground: oklch(0.505 0.190 27.518);
  --border: oklch(0.229 0.050 262.971 / 10%);
  --input: oklch(0.229 0.050 262.971 / 15%);
  --ring: oklch(0.229 0.050 262.971 / 40%);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --radius: 0.5rem;
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}
```

(`--chart-*` and `--sidebar-*` are carried over unchanged — both explicitly out of scope per Global Constraints. The `.dark { ... }` block below this is also left completely unchanged — dark mode is out of scope.)

Note on the two color values that carry an alpha channel (`--border`, `--input`, `--ring`, and `--muted-foreground`): these use CSS's `oklch(L C H / alpha%)` syntax, which is already the pattern this file uses elsewhere (see the existing `.dark` block's `--border: oklch(1 0 0 / 10%)`), so no new syntax is being introduced.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this task only touches CSS).

- [ ] **Step 4: Visual check**

Run: `npm run dev`, open `http://localhost:3000`. In DevTools, inspect `:root` in the Elements/Styles panel — `--background` should compute to an off-white (not `#fff`), `--foreground`/`--primary` should compute to a dark navy (not black/gray). The existing "Trace Dashboard — Phase 0 RLS Proof" page will still render with its old hardcoded `bg-zinc-50`/`text-black` classes at this point (Task 5 replaces those) — that's expected, this task only lands the tokens.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "Set navy-ink color tokens, off-white canvas, hairline borders, semantic colors"
```

---

## Task 3: `StatusBadge` component

**Files:**
- Create: `src/components/ui/status-badge.tsx`

**Interfaces:**
- Consumes: Tailwind classes `bg-success`/`text-success-foreground`, `bg-warning`/`text-warning-foreground`, `bg-danger`/`text-danger-foreground` (from Task 2); `cn()` from `@/lib/utils`.
- Produces: `StatusBadge({ status: "success" | "warning" | "danger", label: string, className?: string })` — a `<span>` pill with icon + text, consumed by Task 5.

- [ ] **Step 1: Create the component**

```tsx
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "success" | "warning" | "danger";

const STATUS_CONFIG: Record<
  Status,
  { icon: LucideIcon; bg: string; fg: string }
> = {
  success: { icon: CheckCircle2, bg: "bg-success", fg: "text-success-foreground" },
  warning: { icon: AlertTriangle, bg: "bg-warning", fg: "text-warning-foreground" },
  danger: { icon: XCircle, bg: "bg-danger", fg: "text-danger-foreground" },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  label: string;
  className?: string;
}) {
  const { icon: Icon, bg, fg } = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        bg,
        fg,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/status-badge.tsx
git commit -m "Add StatusBadge component (success/warning/danger, icon + label)"
```

---

## Task 4: `BentoTile` and `BentoGrid` primitives

**Files:**
- Create: `src/components/ui/bento-tile.tsx`
- Create: `src/components/ui/bento-grid.tsx`

**Interfaces:**
- Consumes: `cva`/`VariantProps` from `class-variance-authority` (existing pattern, see `src/components/ui/button.tsx`); `cn()` from `@/lib/utils`; Tailwind classes `border-border`, `bg-card` (from Task 2).
- Produces: `BentoTile({ size?: "1x1" | "2x1" | "1x2" | "2x2", className?, children, ...divProps })` and `BentoGrid({ className?, children, ...divProps })`, both consumed by Task 5.

- [ ] **Step 1: Create `BentoTile`**

```tsx
import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const bentoTileVariants = cva("rounded-xl border border-border bg-card p-6", {
  variants: {
    size: {
      "1x1": "col-span-1 row-span-1",
      "2x1": "col-span-2 row-span-1",
      "1x2": "col-span-1 row-span-2",
      "2x2": "col-span-2 row-span-2",
    },
  },
  defaultVariants: {
    size: "1x1",
  },
});

export interface BentoTileProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bentoTileVariants> {}

export function BentoTile({ className, size, ...props }: BentoTileProps) {
  return <div className={cn(bentoTileVariants({ size, className }))} {...props} />;
}
```

No shadows in this class list, per Global Constraints — border + `bg-card` (one step lighter than `bg-background`) is the entire separation mechanism.

- [ ] **Step 2: Create `BentoGrid`**

```tsx
import type * as React from "react";

import { cn } from "@/lib/utils";

export function BentoGrid({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-6 auto-rows-[minmax(140px,auto)] sm:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/bento-tile.tsx src/components/ui/bento-grid.tsx
git commit -m "Add BentoTile and BentoGrid layout primitives"
```

---

## Task 5: Reskin the Phase 0 proof page with the new system

**Files:**
- Modify: `src/app/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `BentoGrid`/`BentoTile` (Task 4), `StatusBadge` (Task 3), color/font tokens (Tasks 1-2). Existing `getPaymentsCount()` logic, `createClientWithJwt` (`@/lib/supabase/server`), `getDevJwt` (`@/lib/auth/dev-identity`) are unchanged — this task only changes the JSX/styling, not the data-fetching.

- [ ] **Step 1: Replace `src/app/page.tsx`**

```tsx
import { createClientWithJwt } from "@/lib/supabase/server";
import { getDevJwt } from "@/lib/auth/dev-identity";
import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoTile } from "@/components/ui/bento-tile";
import { StatusBadge } from "@/components/ui/status-badge";

type CountResult = { count: number | null; error: string | null };

async function getPaymentsCount(role: "admin" | "client"): Promise<CountResult> {
  const jwt = await getDevJwt(role);
  const supabase = createClientWithJwt(jwt);
  const { count, error } = await supabase
    .from("payments")
    .select("*", { count: "exact", head: true });
  if (error) return { count: null, error: error.message };
  return { count, error: null };
}

function CountTile({ label, result }: { label: string; result: CountResult }) {
  return (
    <BentoTile className="flex flex-col justify-between gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <StatusBadge
          status={result.error ? "danger" : "success"}
          label={result.error ? "Error" : "RLS scoped"}
        />
      </div>
      <p className="font-heading text-4xl font-semibold tabular-nums text-foreground">
        {result.error ? "—" : result.count}
      </p>
      {result.error && (
        <p className="text-xs text-danger-foreground">{result.error}</p>
      )}
    </BentoTile>
  );
}

export default async function Home() {
  const [admin, client] = await Promise.all([
    getPaymentsCount("admin"),
    getPaymentsCount("client"),
  ]);

  return (
    <div className="min-h-screen bg-background p-16">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Trace Dashboard — Phase 0 RLS Proof
        </h1>
        <BentoGrid className="sm:grid-cols-2">
          <CountTile label="Admin (is_admin claim)" result={admin} />
          <CountTile label="Test client (client_id claim)" result={client} />
        </BentoGrid>
        <p className="max-w-md text-sm text-muted-foreground">
          Both counts are read through RLS-scoped Supabase clients — the admin JWT
          carries <code>is_admin: true</code>, the test-client JWT carries a
          specific <code>client_id</code>. If RLS is working, the test-client
          count should be strictly smaller than the admin count.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds (this also catches any Server Component issues the dev server might not surface immediately).

- [ ] **Step 4: Visual check in the browser (per `CLAUDE.md`'s UI-change rule — do not skip this)**

Run: `npm run dev`, open `http://localhost:3000`, with `DEV_ROLE`/`DEV_CLIENT_ID` env vars set as required by `src/lib/auth/dev-identity.ts` for the dev-identity stub to resolve both roles. Confirm all of the following, matching the spec doc's decisions:
- Page background is off-white, not stark white or gray.
- Both tiles have a visible thin border and **no drop shadow**.
- Tile background is white, one step lighter than the page background.
- The big count number is dark navy, not black, and renders in Geist (visibly different letterforms from the Inter body text around it).
- Each tile shows a pill-shaped badge with an icon (checkmark if no error, X if error) plus the text "RLS scoped" or "Error" — not a bare color swatch.
- The test-client count is strictly smaller than the admin count (this was already true in Phase 0 — confirms the reskin didn't touch the underlying RLS behavior).

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "Reskin Phase 0 proof page with bento tiles, status badges, and new tokens"
```

---

## Self-Review

**Spec coverage:** Ink color (Task 2), canvas (Task 2), no shadows (Task 4, `BentoTile` has no shadow class), hairline borders (Task 2's `--border` + Task 4's `border border-border`), semantic success/warning/danger with icon+label (Task 2 tokens + Task 3 `StatusBadge`), Geist headers/Inter body/Geist Mono deferred-to-tables (Task 1; the plan does not force Geist Mono onto the hero KPI number, matching the spec table's explicit split), bento grid (Task 4), light-mode-first with dark mode untouched (Task 2 note) — all covered. Chart categorical palette and exact tile-sizing/breakpoint rules are explicitly deferred in the spec itself and correctly not included here.

**Placeholder scan:** No TBD/TODO markers; every step has runnable code, not descriptions of code.

**Type consistency:** `StatusBadge`'s `status` prop type (`"success" | "warning" | "danger"`) is used identically in Task 5's `CountTile`. `BentoTile`'s `size` variant keys (`"1x1" | "2x1" | "1x2" | "2x2"`) aren't consumed anywhere in Task 5 (both count tiles use the default `"1x1"`), which is correct — Phase 1's real bento layout (larger charts, multi-tile KPI rows) is a separate future plan, not this one.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-08-visual-design-system-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

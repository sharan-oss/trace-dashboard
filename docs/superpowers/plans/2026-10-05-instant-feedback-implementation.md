# Instant Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acknowledge every click in the dashboard at once and show a loading signal during waits: same-page changes dim the content and show a bar, page changes show a skeleton.

**Architecture:**
- One client-side pending layer (`src/components/navigation/pending-navigation.tsx`) wraps the app shell. It owns a single `useTransition`, plus a `useOptimistic` destination href.
- Every navigation goes through it: `usePendingRouter`, `<PendingLink>`, `useRunPending`. So one `isPending` drives a CSS-only fade and progress bar on `<PendingRegion>`.
- Controls read their active state from `useDestination()`, so they switch on click.
- Each dashboard route gets a `loading.tsx` skeleton.
- A Vitest guard keeps future code from bypassing the layer.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2 (`useTransition`, `useOptimistic`, `useFormStatus`), Tailwind v4, Vitest (Node env), Playwright MCP for the browser walk.

**Spec:** `docs/superpowers/specs/2026-10-05-instant-feedback-design.md`. Read it first. Note the two "Corrected while planning" points in it: the Overview route group, and the fixed-position bar.

## Global Constraints

- Next.js in this repo is 16.x and differs from training data. Read `node_modules/next/dist/docs/` before using an API you are unsure of (the repo's `AGENTS.md` says so).
- Timings and look (from the spec):
  - Content fades to opacity `0.55` after `150ms`; the bar appears after `400ms`; un-dimming is immediate.
  - The bar is 2 px, an indigo gradient (`--primary-hover` → `--accent-foreground`), sliding over `1.1s`.
  - Skeletons pulse (`animate-pulse`); no shimmer.
- `prefers-reduced-motion: reduce`: the bar is static (full width, opacity 0.7) and skeletons don't pulse.
- Tokens go on `:root` in `src/app/globals.css`. Never hard-code palette values in components. Never use shadows, and never scale on hover.
- No new npm dependencies.
- Never use `getSession()` in server code, never use the service-role key, and never write to Trace's tables. This plan touches none of that.
- Browser verification runs against a **local** `next build && next start`, never production. Prefetching is disabled in `next dev`, so the dev server can't verify navigation behaviour.
- Tests run against the live Supabase project and must stay read-only. The two new test files touch no database.
- `$SCRATCHPAD` means the executing session's scratchpad directory, never the repo. Cookies and screenshots go there.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The working tree contains Sharan's unrelated uncommitted work (`.gitignore`, `src/proxy.ts`, `src/app/new/`, `docs/superpowers/research/*`). Never stage those; always `git add` explicit paths.

## Review Focus

These are inputs the spec implies but that no unit test exercises. Each one is pinned by a check in Task 5's browser walk:

1. **Cmd-, ctrl- or middle-click on any `PendingLink`** must open a new tab and must not dim the current page (`onNavigate` doesn't fire for modified clicks).
2. **Two quick clicks** (for example "Last 7 days", then "All time" before the first answer arrives): the final pill and data match the *last* click, and the fade lifts exactly once.
3. **Browser back/forward after tracked navigations:** the active pill, tab and sidebar item match the URL with no stale optimistic state, and nothing stays faded.
4. **A long, scrolled page** (Customers → People, scrolled to the bottom): the bar is visible at the top of the viewport while a sort or page change loads.
5. **A server error during a tracked navigation:** the fade lifts, `error.tsx` renders inside the shell, and **Try again** recovers.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/navigation/destination.ts` (new) | Pure helpers: parse the in-flight destination, resolve a tab's active key, sidebar active match. Unit-tested. |
| `src/components/navigation/pending-navigation.tsx` (new) | Provider, `usePendingRouter`, `useRunPending`, `usePendingState`, `useDestination`, `PendingLink`, `PendingRegion`. The only file allowed to import `next/link` / `useRouter`. |
| `src/components/navigation/link-tabs.tsx` (new) | The shared segmented link strip (Ads views, Customers views, Funnel lenses). |
| `src/components/ui/skeleton.tsx` (new) | `Skeleton` primitive. |
| `src/components/page-skeleton.tsx` (new) | Layout blocks every `loading.tsx` composes: `PageSkeleton`, `KpiGridSkeleton`, `TabsSkeleton`, `CardSkeleton`, `TableCardSkeleton`. |
| `src/components/ui/submit-icon-button.tsx` (new) | Icon-only submit button with a `useFormStatus` spinner. |
| `src/app/(dashboard)/(overview)/page.tsx` (moved) | Overview, moved from `(dashboard)/page.tsx` so it gets its own loading boundary. |
| `src/app/(dashboard)/**/loading.tsx` (5 new, 1 refactored) | Route skeletons. |
| `src/app/(dashboard)/error.tsx` (new) | Dashboard error boundary. |
| `src/app/globals.css` | Pending tokens and `.pending-*` CSS. |
| `scripts/test-session-cookie.ts` (new) | Prints the admin test user's SSR cookies for local browser walks. |
| `tests/navigation-destination.test.ts` (new) | Unit tests for `destination.ts`. |
| `tests/pending-navigation-guard.test.ts` (new) | Every dashboard page has a `loading.tsx`; nothing imports `next/link`/`useRouter` outside the layer. |

---

### Task 1: Pending layer, wired end to end on the Overview, plus the assumption check

**Files:**
- Create: `src/lib/navigation/destination.ts`
- Create: `tests/navigation-destination.test.ts`
- Create: `src/components/navigation/pending-navigation.tsx`
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/page-skeleton.tsx`
- Create: `src/app/(dashboard)/(overview)/loading.tsx`
- Create: `scripts/test-session-cookie.ts`
- Move: `src/app/(dashboard)/page.tsx` → `src/app/(dashboard)/(overview)/page.tsx`
- Modify: `src/app/globals.css` (`:root` block ends at line 116; `@layer base` block ends at line 140)
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/date-range-picker.tsx` (imports at lines 6–7, component head at lines 27–46)

**Interfaces:**
- Produces, from `@/lib/navigation/destination`:
  - `type Destination = { pathname: string; searchParams: URLSearchParams; pending: boolean }`
  - `parseDestination(href: string | null, currentPathname: string, currentSearch: string): Destination`
  - `activeTabKey<K extends string>(dest: Destination, tab: { basePath: string; param: string; keys: readonly K[]; defaultKey: K; current: K }): K`
  - `isNavItemActive(href: string, pathname: string): boolean`
- Produces, from `@/components/navigation/pending-navigation`:
  - `PendingNavigationProvider({ children })`
  - `usePendingRouter(): { push(href: string, options?: { scroll?: boolean }): void; replace(href: string, options?: { scroll?: boolean }): void; refresh(): void }`
  - `useRunPending(): (fn: () => void | Promise<void>) => void`
  - `usePendingState(): boolean`
  - `useDestination(): Destination`
  - `PendingLink` (the props of `next/link` minus `href`/`onNavigate`, plus `href: string`)
  - `PendingRegion({ children })`
- Produces, from `@/components/ui/skeleton`: `Skeleton({ className?: string })`.
- Produces, from `@/components/page-skeleton`:
  - `PageSkeleton({ title: string; controls?: boolean; children })`, whose root carries `data-skeleton` and `aria-busy="true"`
  - `KpiGridSkeleton({ count?: number })`
  - `TabsSkeleton()`
  - `CardSkeleton({ className?: string })`
  - `TableCardSkeleton({ rows?: number })`

- [ ] **Step 1: Write the failing unit test**

Create `tests/navigation-destination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  activeTabKey,
  isNavItemActive,
  parseDestination,
  type Destination,
} from "@/lib/navigation/destination";

/**
 * Pure tests for the pending layer's destination logic — what makes a clicked
 * tab, pill or sidebar item show as active before the server answers.
 */

const TAB = {
  basePath: "/customers",
  param: "tab",
  keys: ["value", "people"] as const,
  defaultKey: "value" as const,
  current: "value" as const,
};

describe("parseDestination", () => {
  it("returns the current URL, not pending, when nothing is in flight", () => {
    const d = parseDestination(null, "/customers", "tab=people&range=7d");
    expect(d.pending).toBe(false);
    expect(d.pathname).toBe("/customers");
    expect(d.searchParams.get("tab")).toBe("people");
  });

  it("parses an absolute destination href and marks it pending", () => {
    const d = parseDestination("/ads?tab=ads&range=7d", "/", "");
    expect(d.pending).toBe(true);
    expect(d.pathname).toBe("/ads");
    expect(d.searchParams.get("tab")).toBe("ads");
  });

  it("resolves a query-only href against the current path", () => {
    const d = parseDestination("?range=all", "/funnel", "range=7d");
    expect(d.pathname).toBe("/funnel");
    expect(d.searchParams.get("range")).toBe("all");
  });
});

describe("activeTabKey", () => {
  const at = (href: string | null, path = "/customers", search = "tab=value"): Destination =>
    parseDestination(href, path, search);

  it("uses the server's active tab when nothing is in flight", () => {
    expect(activeTabKey(at(null), TAB)).toBe("value");
  });

  it("uses the server's active tab when heading to a different page", () => {
    expect(activeTabKey(at("/funnel?tab=people"), TAB)).toBe("value");
  });

  it("shows the clicked tab while its navigation is in flight", () => {
    expect(activeTabKey(at("/customers?tab=people&range=7d"), TAB)).toBe("people");
  });

  it("falls back to the page default when the destination names no tab", () => {
    expect(activeTabKey(at("/customers", "/customers", "tab=people"), { ...TAB, current: "people" })).toBe("value");
  });

  it("falls back to the page default for an unknown tab value", () => {
    expect(activeTabKey(at("/customers?tab=bogus"), TAB)).toBe("value");
  });
});

describe("isNavItemActive", () => {
  it("matches Overview only on the root path", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/", "/ads")).toBe(false);
  });

  it("matches a section and its sub-pages", () => {
    expect(isNavItemActive("/ads", "/ads")).toBe(true);
    expect(isNavItemActive("/ads", "/ads/sync-log")).toBe(true);
    expect(isNavItemActive("/ads", "/customers")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/navigation-destination.test.ts`
Expected: FAIL. The module `@/lib/navigation/destination` can't be resolved.

- [ ] **Step 3: Implement `destination.ts`**

Create `src/lib/navigation/destination.ts`:

```ts
/**
 * Where the dashboard is headed. While a navigation is in flight the pending
 * layer (src/components/navigation/pending-navigation.tsx) knows the
 * destination href before the server has answered; tabs, date pills and the
 * sidebar read their active state from it, so a click shows at once instead
 * of after the new page renders. Pure, so it is unit-tested without a browser.
 */

export type Destination = {
  pathname: string;
  searchParams: URLSearchParams;
  /** True only while a tracked navigation to this destination is in flight. */
  pending: boolean;
};

// Only pathname and search are ever read; the origin is a parsing necessity.
const BASE = "http://dashboard.local";

export function parseDestination(
  href: string | null,
  currentPathname: string,
  currentSearch: string,
): Destination {
  if (href == null) {
    return {
      pathname: currentPathname,
      searchParams: new URLSearchParams(currentSearch),
      pending: false,
    };
  }
  const url = new URL(href, BASE + currentPathname);
  return { pathname: url.pathname, searchParams: url.searchParams, pending: true };
}

/**
 * The tab a URL-driven tab strip should show as active. The server's `current`
 * wins unless a navigation to this same page is in flight — then the tab named
 * in the destination does, or the page's default when it names none (or names
 * one that does not exist, which the page itself would also default).
 */
export function activeTabKey<K extends string>(
  dest: Destination,
  tab: {
    basePath: string;
    param: string;
    keys: readonly K[];
    defaultKey: K;
    current: K;
  },
): K {
  if (!dest.pending || dest.pathname !== tab.basePath) return tab.current;
  const value = dest.searchParams.get(tab.param);
  return value != null && (tab.keys as readonly string[]).includes(value)
    ? (value as K)
    : tab.defaultKey;
}

/** Sidebar matching: Overview only on "/", a section on itself and its sub-pages. */
export function isNavItemActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/navigation-destination.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Create the pending layer**

Create `src/components/navigation/pending-navigation.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from "react";
import { parseDestination, type Destination } from "@/lib/navigation/destination";

/**
 * The one place that knows a click is in flight.
 *
 * Next runs router navigations as React transitions, which keep the old page
 * on screen and expose no pending signal unless the caller asks. Routing every
 * dashboard navigation through one shared startTransition gives one isPending
 * for the whole app: PendingRegion turns it into the fade + progress bar, and
 * useDestination() lets controls show the clicked state before the server
 * answers. Spec: docs/superpowers/specs/2026-10-05-instant-feedback-design.md.
 *
 * Dashboard code must not import next/link or useRouter directly — use
 * PendingLink / usePendingRouter (tests/pending-navigation-guard.test.ts).
 */

type NavOptions = { scroll?: boolean };

type PendingNavigation = {
  isPending: boolean;
  destination: string | null;
  navigate: (method: "push" | "replace", href: string, options?: NavOptions) => void;
  refresh: () => void;
  runPending: (fn: () => void | Promise<void>) => void;
};

const PendingContext = createContext<PendingNavigation | null>(null);

export function PendingNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Reverts to null on its own once the transition settles — by then the real
  // URL already says the same thing.
  const [destination, setDestination] = useOptimistic<string | null>(null);

  const navigate = useCallback(
    (method: "push" | "replace", href: string, options?: NavOptions) => {
      startTransition(() => {
        setDestination(href);
        router[method](href, options);
      });
    },
    [router, setDestination],
  );

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const runPending = useCallback((fn: () => void | Promise<void>) => {
    startTransition(async () => {
      await fn();
    });
  }, []);

  const value = useMemo(
    () => ({ isPending, destination, navigate, refresh, runPending }),
    [isPending, destination, navigate, refresh, runPending],
  );

  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

function usePendingNavigation(): PendingNavigation {
  const ctx = useContext(PendingContext);
  if (ctx == null) {
    throw new Error(
      "Pending navigation hooks must render inside <PendingNavigationProvider> (AppShell).",
    );
  }
  return ctx;
}

/** Drop-in for next/navigation's useRouter (push / replace / refresh), tracked. */
export function usePendingRouter() {
  const { navigate, refresh } = usePendingNavigation();
  return useMemo(
    () => ({
      push: (href: string, options?: NavOptions) => navigate("push", href, options),
      replace: (href: string, options?: NavOptions) => navigate("replace", href, options),
      refresh,
    }),
    [navigate, refresh],
  );
}

/**
 * Runs an async function — typically a server action — inside the shared
 * transition, so the page dims until its result has rendered. The caller may
 * set its own useOptimistic state inside `fn`.
 */
export function useRunPending() {
  return usePendingNavigation().runPending;
}

export function usePendingState(): boolean {
  return usePendingNavigation().isPending;
}

/** The URL being navigated to while pending, otherwise the current one. */
export function useDestination(): Destination {
  const { destination } = usePendingNavigation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return parseDestination(destination, pathname, searchParams.toString());
}

type PendingLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & {
  href: string;
};

/**
 * next/link, tracked. It still renders a real <Link>, so prefetching and
 * cmd/ctrl/middle-click (new tab) are untouched — onNavigate only fires for
 * in-app navigation, which is the one we take over.
 */
export function PendingLink({ href, replace, scroll, ...props }: PendingLinkProps) {
  const { navigate } = usePendingNavigation();
  return (
    <Link
      href={href}
      replace={replace}
      scroll={scroll}
      {...props}
      onNavigate={(event) => {
        event.preventDefault();
        navigate(replace ? "replace" : "push", href, scroll === undefined ? undefined : { scroll });
      }}
    />
  );
}

/**
 * Wraps the page area. data-pending drives the CSS-only fade and bar in
 * globals.css (.pending-*); their delays mean a fast response shows neither.
 * The bar is fixed to the viewport top, inset by the sidebar (sm:left-60
 * mirrors AppShell's sm:w-60) — <main> is overflow-auto, so a sticky bar would
 * pin to <main> and scroll away with the window.
 */
export function PendingRegion({ children }: { children: ReactNode }) {
  const { isPending } = usePendingNavigation();
  return (
    <div
      className="pending-region"
      data-pending={isPending ? "" : undefined}
      aria-busy={isPending || undefined}
    >
      <div className="pending-bar fixed inset-x-0 top-0 sm:left-60" aria-hidden="true" />
      <div className="pending-content">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Add the pending tokens and CSS**

In `src/app/globals.css`, insert these lines just before the closing `}` of the `:root` block, after `--sidebar-ring: …;`:

```css
  /* Pending feedback (2026-10-05, instant-feedback spec): stale content fades
     after a beat and the bar appears only once a wait is real, so a fast
     response shows neither. Un-dimming is immediate. */
  --pending-opacity: 0.55;
  --pending-dim-delay: 150ms;
  --pending-bar-delay: 400ms;
```

Append to the end of the file, after the `@layer base { … }` block:

```css
/* Pending feedback — driven by PendingRegion's data-pending. Delays apply on
   the way in only, so the page brightens the instant new content lands. */
.pending-content {
  transition: opacity 200ms ease;
}
.pending-region[data-pending] > .pending-content {
  opacity: var(--pending-opacity);
  transition-delay: var(--pending-dim-delay);
}
.pending-bar {
  z-index: 50;
  height: 2px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}
.pending-bar::before {
  content: "";
  position: absolute;
  inset-block: 0;
  left: -35%;
  width: 35%;
  background: linear-gradient(
    90deg,
    transparent,
    var(--primary-hover),
    var(--accent-foreground),
    var(--primary-hover),
    transparent
  );
  animation: pending-slide 1.1s ease-in-out infinite;
  animation-play-state: paused;
}
.pending-region[data-pending] > .pending-bar {
  opacity: 1;
  transition-delay: var(--pending-bar-delay);
}
.pending-region[data-pending] > .pending-bar::before {
  animation-play-state: running;
}
@keyframes pending-slide {
  from {
    left: -35%;
  }
  to {
    left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pending-bar::before {
    animation: none;
    left: 0;
    width: 100%;
    opacity: 0.7;
  }
}
```

- [ ] **Step 7: Wire the provider and region into `AppShell`**

In `src/components/app-shell.tsx`, add this import below the `SidebarNav` import:

```tsx
import {
  PendingNavigationProvider,
  PendingRegion,
} from "@/components/navigation/pending-navigation";
```

Replace the whole `return ( … );` of `AppShell` with:

```tsx
  return (
    <PendingNavigationProvider>
      <div className="flex min-h-screen flex-col sm:flex-row">
        <aside className="flex shrink-0 flex-col gap-6 border-b border-sidebar-border bg-sidebar p-6 text-sidebar-foreground sm:sticky sm:top-0 sm:h-screen sm:w-60 sm:border-b-0 sm:border-r">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-white">
              Trace
            </span>
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-500">
              dashboard
            </span>
          </div>
          <SidebarNav isAdmin={identity.isAdmin} />
          <div className="flex flex-col gap-4 sm:mt-auto">
            {showSwitcher ? (
              <ClientSwitcher clients={clients} selectedId={selected?.id ?? null} />
            ) : (
              selected && (
                <div className="flex flex-col gap-1.5">
                  <p className="px-1 text-xs font-semibold tracking-wider text-slate-400 uppercase">
                    Client
                  </p>
                  <p className="truncate px-1 text-sm font-medium text-white">
                    {selected.name}
                  </p>
                </div>
              )
            )}
            <AccountMenu identity={identity} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          <PendingRegion>{children}</PendingRegion>
        </main>
      </div>
    </PendingNavigationProvider>
  );
```

The `sm:w-60` on `<aside>` is what `PendingRegion`'s `sm:left-60` mirrors. If one changes, change both.

- [ ] **Step 8: Make the date picker optimistic and tracked**

In `src/components/date-range-picker.tsx`:

Replace line 6, `import { usePathname, useRouter, useSearchParams } from "next/navigation";`, with:

```tsx
import { usePathname, useSearchParams } from "next/navigation";
import { useDestination, usePendingRouter } from "@/components/navigation/pending-navigation";
```

Replace the range import, `import { RANGE_OPTIONS, type RangeState } from "@/lib/range";`, with:

```tsx
import { parseRangeState, RANGE_OPTIONS, type RangeState } from "@/lib/range";
```

Replace the component head: from `export function DateRangePicker({` through `const custom = state.l1.kind === "custom" ? state.l1 : null;`. That covers the destructured props, the props type, the hook calls and `custom`. Replace it with:

```tsx
export function DateRangePicker({
  state: rendered,
  showCustom = false,
  showL2Toggle = false,
}: {
  state: RangeState;
  /**
   * False renders presets only — the form Customers and Funnel use, whose
   * reads take a preset. Offering a custom window there would let the user set
   * one those pages then ignore.
   */
  showCustom?: boolean;
  /** False hides the split control entirely: no L2 rows means it could only read zero. */
  showL2Toggle?: boolean;
}) {
  const router = usePendingRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const destination = useDestination();
  const [open, setOpen] = useState(false);

  // While a change to this page is in flight, show the window being loaded
  // rather than the one on screen — the pill moves on click, not on arrival.
  const state =
    destination.pending && destination.pathname === pathname
      ? parseRangeState(Object.fromEntries(destination.searchParams))
      : rendered;

  const custom = state.l1.kind === "custom" ? state.l1 : null;
```

The rest of the file is unchanged. `router.replace(…, { scroll: false })` in `commit` already matches `usePendingRouter`'s signature.

- [ ] **Step 9: Add the skeleton primitive and blocks**

Create `src/components/ui/skeleton.tsx`:

```tsx
import { cn } from "@/lib/utils";

/**
 * A placeholder bar for loading states — pulses gently, never shimmers, and
 * holds still under prefers-reduced-motion. Override size, radius and (for a
 * quieter secondary line) background via className.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded bg-white/10 motion-reduce:animate-none",
        className,
      )}
    />
  );
}
```

Create `src/components/page-skeleton.tsx`:

```tsx
import type * as React from "react";
import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoTile } from "@/components/ui/bento-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Building blocks for route loading.tsx files. Each page's skeleton mirrors
 * its real layout with the same grid and card classes and reserves real
 * heights, so nothing shifts when data lands. The title is the page's real
 * <h1>; data-skeleton marks the frame for tests and browser checks.
 */

export function PageSkeleton({
  title,
  controls = true,
  children,
}: {
  title: string;
  /** False when the page header has no date picker or buttons. */
  controls?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8" aria-busy="true" data-skeleton="">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <Skeleton className="mt-2 h-4 w-40 bg-white/5" />
        </div>
        {controls && <Skeleton className="h-8 w-64 rounded-lg" />}
      </header>
      {children}
    </div>
  );
}

export function KpiGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <BentoGrid className="auto-rows-[minmax(120px,auto)]">
      {Array.from({ length: count }, (_, i) => (
        <BentoTile key={i} className="flex flex-col justify-between gap-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-28" />
        </BentoTile>
      ))}
    </BentoGrid>
  );
}

export function TabsSkeleton() {
  return <Skeleton className="h-8 w-44 rounded-lg" />;
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-2xl border border-border bg-card motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function TableCardSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-border bg-card p-4 backdrop-blur-md"
    >
      <Skeleton className="mb-2 h-4 w-36" />
      <Skeleton className="mb-5 h-3 w-56 bg-white/5" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-16 bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Move the Overview into its own route group and give it a skeleton**

Run:

```bash
mkdir -p "src/app/(dashboard)/(overview)"
git mv "src/app/(dashboard)/page.tsx" "src/app/(dashboard)/(overview)/page.tsx"
```

All of that file's imports are `@/…` absolute, so nothing else changes. The URL stays `/`.

Create `src/app/(dashboard)/(overview)/loading.tsx`:

```tsx
import {
  CardSkeleton,
  KpiGridSkeleton,
  PageSkeleton,
  TableCardSkeleton,
} from "@/components/page-skeleton";

/** Overview's loading frame: KPI bento, revenue chart, top-ads table. */
export default function OverviewLoading() {
  return (
    <PageSkeleton title="Overview">
      <KpiGridSkeleton />
      <CardSkeleton className="h-80" />
      <TableCardSkeleton rows={6} />
    </PageSkeleton>
  );
}
```

- [ ] **Step 11: Add the test-session cookie script**

Create `scripts/test-session-cookie.ts`:

```ts
/**
 * Prints the @supabase/ssr session cookies for the ADMIN TEST USER as JSON,
 * ready for Playwright's context.addCookies — for browser walks against a
 * local `next start`. Test identity only (the same one tests/helpers signs in
 * with); never a real user, never production.
 *
 *   npx tsx scripts/test-session-cookie.ts [baseUrl]   # default http://localhost:3100
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const base = new URL(process.argv[2] ?? "http://localhost:3100");

async function main() {
  const { data, error } = await createClient(url, key).auth.signInWithPassword({
    email: "dashboard-admin-test@trace.local",
    password: "trace-dashboard-phase0-test!",
  });
  if (error) throw error;

  // Let @supabase/ssr serialise the session exactly as the app reads it.
  const jar = new Map<string, string>();
  const ssr = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await ssr.auth.setSession({
    access_token: data.session!.access_token,
    refresh_token: data.session!.refresh_token,
  });

  const cookies = [...jar].map(([name, value]) => ({
    name,
    value,
    domain: base.hostname,
    path: "/",
    httpOnly: false,
    secure: base.protocol === "https:",
    sameSite: "Lax" as const,
  }));
  console.log(JSON.stringify(cookies));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 12: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all tests pass, including the 10 new ones. If many fail with "fetch failed" during sign-in, that's the known transient auth flake: re-run once before investigating.

- [ ] **Step 13: Build and start a production server locally**

```bash
npm run build
```

Expected: the build succeeds. If it fails with "useSearchParams() should be wrapped in a suspense boundary", stop and report it: every dashboard route is dynamic, so this would mean a static route renders AppShell, which the spec doesn't expect.

Start the server in the background: `npm run start -- -p 3100`. Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` returns `200`.

Generate cookies into the scratchpad: `npx tsx scripts/test-session-cookie.ts http://localhost:3100 > "$SCRATCHPAD/cookies.json"`.

- [ ] **Step 14: The assumption check (gate)**

Use the Playwright MCP tool `browser_run_code_unsafe`. Paste the contents of `cookies.json` in place of `COOKIES_JSON`.

```js
async (page) => {
  await page.context().addCookies(COOKIES_JSON);
  await page.goto("http://localhost:3100/?range=30d");
  await page.waitForSelector(".pending-region .pending-content h1");
  await page.evaluate(() => {
    const region = document.querySelector(".pending-region");
    const content = () => document.querySelector(".pending-content");
    window.__initial = content().innerText;
    window.__log = [];
    const t0 = performance.now();
    const snap = (why) =>
      window.__log.push({
        why,
        t: Math.round(performance.now() - t0),
        pending: region.hasAttribute("data-pending"),
        skeleton: !!document.querySelector("[data-skeleton]"),
        changed: content().innerText !== window.__initial,
        activePill: document.querySelector('[aria-label="Date range"] [aria-pressed="true"]')?.textContent,
      });
    window.__snap = snap;
    window.__mo = new MutationObserver(() => snap("mutation"));
    window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await page.evaluate(() => requestAnimationFrame(() => window.__snap("first-frame")));
  await page.waitForTimeout(10000);
  return page.evaluate(() => {
    window.__mo.disconnect();
    const log = window.__log;
    const firstFrame = log.find((e) => e.why === "first-frame");
    const firstPending = log.find((e) => e.pending);
    const pendingIdx = log.findIndex((e) => e.pending);
    const settled = log.slice(pendingIdx).find((e) => !e.pending);
    return {
      pillOnFirstFrame: firstFrame?.activePill,
      pendingAtMs: firstPending?.t,
      skeletonEverShown: log.some((e) => e.skeleton),
      settledAtMs: settled?.t,
      contentChangedWhenSettled: settled?.changed,
      entries: log.length,
    };
  });
}
```

**Pass criteria. All must hold:**

- `pillOnFirstFrame === "Last 7 days"`: the pill moved on click.
- `pendingAtMs` < 100: tracked immediately.
- `skeletonEverShown === false`: a same-page change fades the page and doesn't flash the skeleton.
- `contentChangedWhenSettled === true`: `isPending` stayed on until the new data had rendered.

**If any criterion fails, STOP.** Don't continue to Step 15 or to later tasks. Report the returned object to Sharan, because the spec's core assumption is wrong and the design needs revisiting.

Also check sidebar navigation to a page with a skeleton. Use `browser_run_code_unsafe`:

```js
async (page) => {
  await page.goto("http://localhost:3100/ads/sync-log");
  await page.waitForSelector(".pending-content h1");
  await page.waitForTimeout(1500); // let the sidebar's Overview link prefetch
  await page.getByRole("link", { name: "Overview" }).click();
  const sawSkeleton = await page
    .waitForSelector("[data-skeleton]", { timeout: 1000 })
    .then(() => true, () => false);
  await page.waitForSelector(".pending-content h1:text('Overview')", { timeout: 15000 });
  return { sawSkeleton };
}
```

Expected: `{ sawSkeleton: true }`. If it is false, report it too. The route-group move exists precisely for this.

Stop the local server when done.

- [ ] **Step 15: Commit**

```bash
git add src/lib/navigation/destination.ts tests/navigation-destination.test.ts \
  src/components/navigation/pending-navigation.tsx src/components/ui/skeleton.tsx \
  src/components/page-skeleton.tsx "src/app/(dashboard)/(overview)/page.tsx" \
  "src/app/(dashboard)/(overview)/loading.tsx" \
  src/app/globals.css src/components/app-shell.tsx src/components/date-range-picker.tsx \
  scripts/test-session-cookie.ts
git commit -m "feat(loading): shared pending layer, wired on Overview's date range

One startTransition for the whole shell: fade after 150ms, bar after 400ms,
the clicked pill switches on click. Overview moves into an (overview) route
group so it gets its own loading boundary and skeleton.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Skeletons for every remaining dashboard page

**Files:**
- Create: `tests/pending-navigation-guard.test.ts`
- Create: `src/app/(dashboard)/customers/loading.tsx`
- Create: `src/app/(dashboard)/funnel/loading.tsx`
- Create: `src/app/(dashboard)/ads/sync-log/loading.tsx`
- Create: `src/app/(dashboard)/settings/users/loading.tsx`
- Modify: `src/app/(dashboard)/ads/loading.tsx` (whole file)

**Interfaces:**
- Consumes: `PageSkeleton`, `KpiGridSkeleton`, `TabsSkeleton`, `CardSkeleton`, `TableCardSkeleton` from `@/components/page-skeleton` (Task 1).
- Produces: `tests/pending-navigation-guard.test.ts`, which exports nothing. Task 3 adds a second `describe` block to this same file.

- [ ] **Step 1: Write the failing guard test**

Create `tests/pending-navigation-guard.test.ts`:

```ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards for the instant-feedback design
 * (docs/superpowers/specs/2026-10-05-instant-feedback-design.md). Static file
 * scans — no database, no browser.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(SRC, f).split(sep).join("/");

describe("every dashboard page has its own loading skeleton", () => {
  it("has a loading.tsx beside each (dashboard) page.tsx", () => {
    const missing = FILES.filter(
      (f) => rel(f).startsWith("app/(dashboard)/") && rel(f).endsWith("/page.tsx"),
    )
      .filter((f) => !existsSync(join(dirname(f), "loading.tsx")))
      .map(rel);
    expect(
      missing,
      "Add a loading.tsx next to each page, composed from @/components/page-skeleton — without one, navigating here shows nothing until the server answers.",
    ).toEqual([]);
  });

  it("puts no loading.tsx directly in (dashboard)/, which would shadow every page's own", () => {
    expect(existsSync(join(SRC, "app/(dashboard)/loading.tsx"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/pending-navigation-guard.test.ts`
Expected: FAIL. `missing` lists `app/(dashboard)/customers/page.tsx`, `app/(dashboard)/funnel/page.tsx`, `app/(dashboard)/ads/sync-log/page.tsx` and `app/(dashboard)/settings/users/page.tsx`.

- [ ] **Step 3: Add the four skeletons and refactor Ads**

Create `src/app/(dashboard)/customers/loading.tsx`:

```tsx
import {
  CardSkeleton,
  KpiGridSkeleton,
  PageSkeleton,
  TableCardSkeleton,
  TabsSkeleton,
} from "@/components/page-skeleton";

/** Customers' loading frame: Value | People tabs, KPI bento, value bar, table. */
export default function CustomersLoading() {
  return (
    <PageSkeleton title="Customers">
      <TabsSkeleton />
      <KpiGridSkeleton />
      <CardSkeleton className="h-28" />
      <TableCardSkeleton />
    </PageSkeleton>
  );
}
```

Create `src/app/(dashboard)/funnel/loading.tsx`:

```tsx
import { CardSkeleton, PageSkeleton, TableCardSkeleton } from "@/components/page-skeleton";

/** Funnel's loading frame: stage card, wasted-clicks strip, lens table. */
export default function FunnelLoading() {
  return (
    <PageSkeleton title="Funnel">
      <CardSkeleton className="h-56" />
      <CardSkeleton className="h-16" />
      <TableCardSkeleton />
    </PageSkeleton>
  );
}
```

Create `src/app/(dashboard)/ads/sync-log/loading.tsx`:

```tsx
import { PageSkeleton, TableCardSkeleton } from "@/components/page-skeleton";

/** Sync log's loading frame: one runs table. */
export default function SyncLogLoading() {
  return (
    <PageSkeleton title="Sync log" controls={false}>
      <TableCardSkeleton rows={10} />
    </PageSkeleton>
  );
}
```

Create `src/app/(dashboard)/settings/users/loading.tsx`:

```tsx
import { CardSkeleton, PageSkeleton, TableCardSkeleton } from "@/components/page-skeleton";

/** Users' loading frame: add-user card, access list. */
export default function UsersLoading() {
  return (
    <PageSkeleton title="Users" controls={false}>
      <CardSkeleton className="h-40" />
      <TableCardSkeleton rows={5} />
    </PageSkeleton>
  );
}
```

Replace the whole of `src/app/(dashboard)/ads/loading.tsx` with:

```tsx
import {
  CardSkeleton,
  KpiGridSkeleton,
  PageSkeleton,
  TabsSkeleton,
} from "@/components/page-skeleton";

/** Skeleton for the Ads page — the loading state, visibly distinct from empty. */
export default function AdsLoading() {
  return (
    <PageSkeleton title="Ads">
      <TabsSkeleton />
      <KpiGridSkeleton />
      <CardSkeleton className="h-80" />
    </PageSkeleton>
  );
}
```

- [ ] **Step 4: Run the guard and the typecheck**

Run: `npx vitest run tests/pending-navigation-guard.test.ts && npm run typecheck`
Expected: PASS (2 tests), and the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add tests/pending-navigation-guard.test.ts "src/app/(dashboard)/customers/loading.tsx" \
  "src/app/(dashboard)/funnel/loading.tsx" "src/app/(dashboard)/ads/sync-log/loading.tsx" \
  "src/app/(dashboard)/settings/users/loading.tsx" "src/app/(dashboard)/ads/loading.tsx"
git commit -m "feat(loading): skeletons for every dashboard page, guarded by test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Route every control through the pending layer

**Files:**
- Modify: `tests/pending-navigation-guard.test.ts` (append a `describe` block)
- Create: `src/components/navigation/link-tabs.tsx`
- Modify: `src/components/sidebar-nav.tsx`
- Modify: `src/components/client-switcher.tsx`
- Modify: `src/components/ads/ads-tabs.tsx`
- Modify: `src/components/customers/customers-tabs.tsx`
- Modify: `src/components/funnel/funnel-segments.tsx`
- Modify (import swaps): `src/components/ads/campaigns-table.tsx`, `src/components/ads/ad-cards.tsx`, `src/components/ads/sync-now-button.tsx`, `src/components/customers/people-table.tsx`, `src/components/customers/customer-sheet.tsx`, `src/components/customers/record-payment-sheet.tsx`, `src/components/overview/day-detail-sheet.tsx`, `src/components/overview/revenue-chart-card.tsx`, `src/components/overview/top-ads-table.tsx`, `src/app/(dashboard)/ads/page.tsx`, `src/app/(dashboard)/ads/sync-log/page.tsx`, `src/app/(dashboard)/customers/page.tsx`

**Interfaces:**
- Consumes:
  - from Task 1's `@/components/navigation/pending-navigation`: `PendingLink`, `usePendingRouter`, `useRunPending`, `useDestination`;
  - from Task 1's `@/lib/navigation/destination`: `activeTabKey`, `isNavItemActive`.
- Produces: `LinkTabs<K extends string>({ label: string; tabs: { key: K; label: string; href: string }[]; active: K; basePath: string; param: string; defaultKey: K; className?: string })` from `@/components/navigation/link-tabs`.

- [ ] **Step 1: Add the failing import guard**

Append to `tests/pending-navigation-guard.test.ts`:

```ts
describe("dashboard navigation goes through the pending layer", () => {
  // Outside the dashboard shell there is no PendingNavigationProvider, so these
  // may keep using Next's primitives directly.
  const ALLOWED = [
    "components/navigation/pending-navigation.tsx",
    "app/(auth)/",
    "app/auth/",
    "app/(marketing)/",
    "app/new/",
  ];
  const DIRECT_LINK = /from\s+["']next\/link["']/;
  const DIRECT_ROUTER = /import\s*\{[^}]*\buseRouter\b[^}]*\}\s*from\s+["']next\/navigation["']/;

  it("imports neither next/link nor useRouter outside the layer", () => {
    const offenders = FILES.filter((f) => !ALLOWED.some((a) => rel(f).startsWith(a)))
      .filter((f) => {
        const source = readFileSync(f, "utf8");
        return DIRECT_LINK.test(source) || DIRECT_ROUTER.test(source);
      })
      .map(rel);
    expect(
      offenders,
      "Use PendingLink / usePendingRouter from @/components/navigation/pending-navigation — a direct Link or router gives no feedback while the next page loads.",
    ).toEqual([]);
  });
});
```

Change the test file's first import line to add `readFileSync`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/pending-navigation-guard.test.ts`
Expected: FAIL. `offenders` lists 16 files: the 12 import-swap files plus `sidebar-nav.tsx`, `ads-tabs.tsx`, `customers-tabs.tsx` and `funnel-segments.tsx`. Not `client-switcher.tsx`, which uses a server action rather than the router, and not `date-range-picker.tsx`, which Task 1 already converted.

- [ ] **Step 3: Create `LinkTabs`**

Create `src/components/navigation/link-tabs.tsx`:

```tsx
"use client";

import { activeTabKey } from "@/lib/navigation/destination";
import { cn } from "@/lib/utils";
import { PendingLink, useDestination } from "./pending-navigation";

export type LinkTab<K extends string> = { key: K; label: string; href: string };

/**
 * The dashboard's segmented link strip — Ads views, Customers views, Funnel
 * lenses. Tab state lives in the URL so it stays shareable; while a switch is
 * in flight the clicked tab already shows as active, read from the pending
 * destination rather than waiting for the server.
 */
export function LinkTabs<K extends string>({
  label,
  tabs,
  active,
  basePath,
  param,
  defaultKey,
  className,
}: {
  label: string;
  tabs: LinkTab<K>[];
  /** The tab the server rendered. */
  active: K;
  /** The page these tabs live on, e.g. "/ads". */
  basePath: string;
  /** The search param holding the tab, e.g. "tab" or "lens". */
  param: string;
  /** What the page shows when the param is absent or unknown. */
  defaultKey: K;
  className?: string;
}) {
  const destination = useDestination();
  const shown = activeTabKey(destination, {
    basePath,
    param,
    keys: tabs.map((t) => t.key),
    defaultKey,
    current: active,
  });
  return (
    <nav
      aria-label={label}
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5",
        className,
      )}
    >
      {tabs.map((tab) => (
        <PendingLink
          key={tab.key}
          href={tab.href}
          aria-current={shown === tab.key ? "page" : undefined}
          className={cn(
            "rounded-md px-4 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
            shown === tab.key
              ? "bg-accent text-accent-foreground"
              : "text-slate-400 hover:text-white",
          )}
        >
          {tab.label}
        </PendingLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Switch the three tab strips to `LinkTabs`**

Replace the whole of `src/components/ads/ads-tabs.tsx` with:

```tsx
import { LinkTabs } from "@/components/navigation/link-tabs";

export type AdsTab = "campaigns" | "ads";

/**
 * The Ads section's two sub-views — Campaigns | Ads, Meta Ads Manager's own
 * names. Links, so tab state lives in the URL (?tab=) and stays shareable;
 * switching back to Campaigns deliberately drops any ?campaign= filter, which
 * only means something inside the Ads view.
 *
 * `rangeQuery` is the serialized window (serializeRangeState) rather than a
 * bare preset: these hrefs are built from scratch, so anything not named here
 * — a custom window, a separate L2 window — would be silently reset on a tab
 * switch.
 */
export function AdsTabs({
  active,
  rangeQuery,
}: {
  active: AdsTab;
  rangeQuery: string;
}) {
  return (
    <LinkTabs
      label="Ads section views"
      active={active}
      basePath="/ads"
      param="tab"
      defaultKey="campaigns"
      tabs={[
        { key: "campaigns", label: "Campaigns", href: `/ads?tab=campaigns&${rangeQuery}` },
        { key: "ads", label: "Ads", href: `/ads?tab=ads&${rangeQuery}` },
      ]}
    />
  );
}
```

Replace the whole of `src/components/customers/customers-tabs.tsx` with:

```tsx
import { LinkTabs } from "@/components/navigation/link-tabs";
import type { RangePreset } from "@/lib/range";

export type CustomersTab = "value" | "people";

/**
 * The Customers section's two sub-views. Value is the economics argument;
 * People is the individuals behind it. Links so tab state lives in the URL and
 * stays shareable — and switching tabs deliberately drops the People-only
 * params (search, sort, page, open customer), which mean nothing on the other
 * side.
 */
export function CustomersTabs({
  active,
  range,
}: {
  active: CustomersTab;
  range: RangePreset;
}) {
  return (
    <LinkTabs
      label="Customers section views"
      active={active}
      basePath="/customers"
      param="tab"
      defaultKey="value"
      tabs={[
        { key: "value", label: "Value", href: `/customers?tab=value&range=${range}` },
        { key: "people", label: "People", href: `/customers?tab=people&range=${range}` },
      ]}
    />
  );
}
```

In `src/components/funnel/funnel-segments.tsx`:

- Replace `import Link from "next/link";` with:

  ```tsx
  import { LinkTabs } from "@/components/navigation/link-tabs";
  import { PendingLink } from "@/components/navigation/pending-navigation";
  ```

- Replace the whole `{lens !== "ad" && ( <nav aria-label="Funnel lens" … </nav> )}` block with:

  ```tsx
  {lens !== "ad" && (
    <LinkTabs
      label="Funnel lens"
      className="mb-4"
      active={lens}
      basePath="/funnel"
      param="lens"
      defaultKey="campaign"
      tabs={LENSES.map((l) => ({
        key: l.value,
        label: l.label,
        href: `/funnel?lens=${l.value}&range=${range}`,
      }))}
    />
  )}
  ```

- Rename the two remaining `<Link` / `</Link>` pairs (the "Campaigns" back link and the drillable campaign name) to `<PendingLink` / `</PendingLink>`. Leave the props unchanged.

- [ ] **Step 5: Sidebar: instant highlight**

Replace the whole of `src/components/sidebar-nav.tsx` with:

```tsx
"use client";

import { Filter, LayoutDashboard, Megaphone, Users, UserCog } from "lucide-react";
import { PendingLink, useDestination } from "@/components/navigation/pending-navigation";
import { isNavItemActive } from "@/lib/navigation/destination";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/funnel", label: "Funnel", icon: Filter },
] as const;

// Client users have no rows visible in app_users, so the page would be an
// empty table for them — it is hidden rather than shown empty.
const ADMIN_ITEMS = [
  { href: "/settings/users", label: "Users", icon: UserCog },
] as const;

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  // The destination, not the rendered path: the highlight moves on click.
  const { pathname } = useDestination();
  const items = isAdmin ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS;

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto sm:flex-col">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isNavItemActive(href, pathname);
        return (
          <PendingLink
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </PendingLink>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Client switcher: optimistic name, tracked action**

In `src/components/client-switcher.tsx`:

- Replace `import { useTransition } from "react";` with:

  ```tsx
  import { useOptimistic } from "react";
  import { useRunPending } from "@/components/navigation/pending-navigation";
  ```

- Replace these two lines:

  ```tsx
  const [isPending, startTransition] = useTransition();
  const selected = clients.find((c) => c.id === selectedId) ?? null;
  ```

  with:

  ```tsx
  const runPending = useRunPending();
  // The picked client shows at once; the page dims until its data arrives.
  const [shownId, setShownId] = useOptimistic(selectedId);
  const selected = clients.find((c) => c.id === shownId) ?? null;
  ```

- Delete the `isPending && "opacity-60",` line from the trigger's `cn(…)`. The page-level fade replaces it.
- Replace `onClick={() => startTransition(() => selectClient(c.id))}` with:

  ```tsx
  onClick={() =>
    runPending(async () => {
      setShownId(c.id);
      await selectClient(c.id);
    })
  }
  ```

- Replace `{c.id === selectedId && (` with `{c.id === shownId && (`.

- [ ] **Step 7: Mechanical import swaps**

Apply exactly these edits. Each file's call sites stay unchanged, because `usePendingRouter()` returns the same `push`/`replace`/`refresh` shape the code already uses.

| File | Replace | With |
|---|---|---|
| `components/ads/campaigns-table.tsx` | `import { useRouter } from "next/navigation";` and `import Link from "next/link";` | `import { PendingLink, usePendingRouter } from "@/components/navigation/pending-navigation";` |
| `components/ads/ad-cards.tsx` | `import { usePathname, useRouter, useSearchParams } from "next/navigation";` | `import { usePathname, useSearchParams } from "next/navigation";` + `import { usePendingRouter } from "@/components/navigation/pending-navigation";` |
| `components/ads/sync-now-button.tsx` | `import { useRouter } from "next/navigation";` | `import { usePendingRouter } from "@/components/navigation/pending-navigation";` |
| `components/customers/people-table.tsx` | `import Link from "next/link";` and `import { usePathname, useRouter, useSearchParams } from "next/navigation";` | `import { usePathname, useSearchParams } from "next/navigation";` + `import { PendingLink, usePendingRouter } from "@/components/navigation/pending-navigation";` |
| `components/customers/customer-sheet.tsx` | same two lines as people-table | same as people-table |
| `components/overview/day-detail-sheet.tsx` | same two lines as people-table | same as people-table |
| `components/customers/record-payment-sheet.tsx` | `import { usePathname, useRouter, useSearchParams } from "next/navigation";` | `import { usePathname, useSearchParams } from "next/navigation";` + `import { usePendingRouter } from "@/components/navigation/pending-navigation";` |
| `components/overview/revenue-chart-card.tsx` | same as record-payment-sheet | same as record-payment-sheet |
| `components/overview/top-ads-table.tsx` | `import Link from "next/link";` | `import { PendingLink } from "@/components/navigation/pending-navigation";` |
| `app/(dashboard)/ads/page.tsx` | `import Link from "next/link";` | same as top-ads-table |
| `app/(dashboard)/ads/sync-log/page.tsx` | `import Link from "next/link";` | same as top-ads-table |
| `app/(dashboard)/customers/page.tsx` | `import Link from "next/link";` | same as top-ads-table |

Then, in every file in that table:

- replace each `useRouter()` call with `usePendingRouter()`;
- replace each `<Link` with `<PendingLink` and each `</Link>` with `</PendingLink>`.

Verify nothing is left: `grep -rn -E '\buseRouter\(|<Link\b|</Link>' src --include='*.tsx' | grep -v pending-navigation.tsx` should print only lines from `src/app/(auth)`, `src/app/auth`, `src/app/(marketing)` or `src/app/new`.

Every existing `href` in these files is a string (verified while planning), so `PendingLink`'s `href: string` accepts them all.

- [ ] **Step 8: Run the guard, the typecheck and the suite**

Run: `npx vitest run tests/pending-navigation-guard.test.ts && npm run typecheck && npm test`
Expected: the guard passes (3 tests), the typecheck is clean, and the full suite is green. Re-run once on a mass "fetch failed" auth flake.

- [ ] **Step 9: Commit**

```bash
git add tests/pending-navigation-guard.test.ts src/components/navigation/link-tabs.tsx \
  src/components/sidebar-nav.tsx src/components/client-switcher.tsx \
  src/components/ads/ads-tabs.tsx src/components/customers/customers-tabs.tsx \
  src/components/funnel/funnel-segments.tsx src/components/ads/campaigns-table.tsx \
  src/components/ads/ad-cards.tsx src/components/ads/sync-now-button.tsx \
  src/components/customers/people-table.tsx src/components/customers/customer-sheet.tsx \
  src/components/customers/record-payment-sheet.tsx src/components/overview/day-detail-sheet.tsx \
  src/components/overview/revenue-chart-card.tsx src/components/overview/top-ads-table.tsx \
  "src/app/(dashboard)/ads/page.tsx" "src/app/(dashboard)/ads/sync-log/page.tsx" \
  "src/app/(dashboard)/customers/page.tsx"
git commit -m "feat(loading): every dashboard control goes through the pending layer

Sidebar, tabs and client switcher show the clicked state on click; filters,
rows and sheets dim the page while loading. A guard test keeps new code from
importing next/link or useRouter directly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Error page and pending icon buttons

**Files:**
- Create: `src/app/(dashboard)/error.tsx`
- Create: `src/components/ui/submit-icon-button.tsx`
- Modify: `src/components/account-menu.tsx`
- Modify: `src/app/(dashboard)/settings/users/page.tsx` (the remove `<form>`)

**Interfaces:**
- Consumes: `buttonVariants` from `@/components/ui/button` (existing export).
- Produces: `SubmitIconButton({ label: string; className?: string; children: React.ReactNode })` from `@/components/ui/submit-icon-button`.

The deliverables are client components with no pure logic, and Vitest runs in Node with no DOM, so verification here is the typecheck plus Task 5's browser walk. Don't add a DOM test environment for this.

- [ ] **Step 1: Create the error boundary**

Create `src/app/(dashboard)/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * A dashboard page failed to render. It sits under the layout, so the sidebar
 * stays usable; Try again re-fetches the segment (Next 16's unstable_retry —
 * reset() would re-render without re-fetching). The URL still holds every
 * filter, so retrying lands exactly where the user was.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <div
        role="alert"
        className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md"
      >
        <TriangleAlert size={24} className="mx-auto mb-3 text-danger-foreground" aria-hidden="true" />
        <h1 className="text-base font-semibold text-white">This page didn&apos;t load</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
          Something went wrong fetching its data. Your filters are kept, so
          trying again picks up where you were.
        </p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className={buttonVariants({ variant: "outline", className: "mt-5" })}
        >
          <RotateCw size={14} aria-hidden="true" />
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 font-mono text-xs text-slate-600">Ref {error.digest}</p>
        )}
      </div>
    </div>
  );
}
```

Check that `buttonVariants` accepts a `className` key: read `src/components/ui/button.tsx`. If its `cva` call doesn't take `className` in its argument, use `cn(buttonVariants({ variant: "outline" }), "mt-5")` instead, importing `cn` from `@/lib/utils`.

- [ ] **Step 2: Create the icon submit button**

Create `src/components/ui/submit-icon-button.tsx`:

```tsx
"use client";

import type * as React from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Icon-only submit for a plain server-action <form>. While the action runs the
 * icon becomes a spinner and the button disables — the design system's loading
 * recipe. The icon comes in as children (a rendered element, not a component
 * reference) so server components can pass it across the client boundary.
 */
export function SubmitIconButton({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn("disabled:opacity-60", className)}
    >
      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : children}
    </button>
  );
}
```

- [ ] **Step 3: Use it for Sign out and Remove user**

In `src/components/account-menu.tsx`, add `import { SubmitIconButton } from "@/components/ui/submit-icon-button";`. Then replace the `<button type="submit" aria-label="Sign out" … </button>` element with:

```tsx
<SubmitIconButton
  label="Sign out"
  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
>
  <LogOut size={15} />
</SubmitIconButton>
```

In `src/app/(dashboard)/settings/users/page.tsx`, add `import { SubmitIconButton } from "@/components/ui/submit-icon-button";`. Then replace the `<button type="submit" aria-label={`Remove ${user.email}`} … </button>` element inside the remove form with:

```tsx
<SubmitIconButton
  label={`Remove ${user.email}`}
  className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-destructive/10 hover:text-destructive"
>
  <Trash2 size={14} />
</SubmitIconButton>
```

- [ ] **Step 4: Typecheck and run the guard**

Run: `npm run typecheck && npx vitest run tests/pending-navigation-guard.test.ts`
Expected: the typecheck is clean and the guard passes. `error.tsx` sits directly in `(dashboard)/`, which is allowed: the "no loading.tsx there" guard is about `loading.tsx` only.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/error.tsx" src/components/ui/submit-icon-button.tsx \
  src/components/account-menu.tsx "src/app/(dashboard)/settings/users/page.tsx"
git commit -m "feat(loading): dashboard error boundary; spinners on sign-out and remove-user

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Browser walk, Review Focus checks, docs

**Files:**
- Modify: `docs/design-system/trace-design-system.md` (§4 "Interaction & motion", around lines 293–299)
- Modify: `docs/STATUS.md` (add a checklist entry)
- Screenshots: the scratchpad only, never committed

**Interfaces:**
- Consumes: everything from Tasks 1–4. Selectors: `.pending-region`, `[data-pending]`, `.pending-content`, `.pending-bar`, `[data-skeleton]`.

- [ ] **Step 1: Fresh production build and server**

```bash
npm run build && npm run start -- -p 3100   # background
npx tsx scripts/test-session-cookie.ts http://localhost:3100 > "$SCRATCHPAD/cookies.json"
```

- [ ] **Step 2: Install the probe and walk every control**

Run this once with `browser_run_code_unsafe` to sign in and define a reusable probe on `window`. Re-run the `addInitScript` part after any full page load; `addInitScript` persists across navigations.

```js
async (page) => {
  await page.context().addCookies(COOKIES_JSON);
  await page.addInitScript(() => {
    window.__probe = () => {
      const region = document.querySelector(".pending-region");
      window.__log = [];
      const t0 = performance.now();
      const snap = (why) => {
        const content = document.querySelector(".pending-content");
        const bar = document.querySelector(".pending-bar");
        window.__log.push({
          why,
          t: Math.round(performance.now() - t0),
          pending: !!region?.hasAttribute("data-pending"),
          skeleton: !!document.querySelector("[data-skeleton]"),
          opacity: content ? getComputedStyle(content).opacity : null,
          bar: bar ? getComputedStyle(bar).opacity : null,
          current: [...document.querySelectorAll('[aria-current="page"],[aria-pressed="true"]')].map((e) => e.textContent?.trim()),
        });
      };
      window.__snap = snap;
      window.__mo?.disconnect();
      window.__mo = new MutationObserver(() => snap("mutation"));
      window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      window.__iv && clearInterval(window.__iv);
      window.__iv = setInterval(() => snap("tick"), 50);
    };
    window.__summary = () => {
      clearInterval(window.__iv);
      window.__mo.disconnect();
      const log = window.__log;
      const first = log.find((e) => e.why === "first-frame");
      const dimAt = log.find((e) => e.opacity != null && Number(e.opacity) < 0.95)?.t ?? null;
      const barAt = log.find((e) => e.bar != null && Number(e.bar) > 0.5)?.t ?? null;
      const end = [...log].reverse().find((e) => !e.pending);
      return { currentOnFirstFrame: first?.current, dimAt, barAt, skeletonSeen: log.some((e) => e.skeleton), endsUnpending: !!end && !log[log.length - 1].pending, finalCurrent: log[log.length - 1]?.current };
    };
  });
  await page.goto("http://localhost:3100/");
  await page.waitForSelector(".pending-content h1");
  return "ready";
}
```

For each row below, use `browser_run_code_unsafe` with this pattern, replacing the `goto` URL and the click:

```js
async (page) => {
  await page.goto("http://localhost:3100/customers?tab=people&range=30d");
  await page.waitForSelector(".pending-content h1");
  await page.evaluate(() => window.__probe());
  await page.getByRole("link", { name: "Value" }).click();          // ← the control under test
  await page.evaluate(() => requestAnimationFrame(() => window.__snap("first-frame")));
  await page.waitForTimeout(8000);
  return page.evaluate(() => window.__summary());
}
```

Expected for **same-page** rows:
- `currentOnFirstFrame` already includes the clicked tab or pill, where the row says it switches instantly;
- `dimAt` is roughly ≥ 150 and `barAt` roughly ≥ 400, unless the response landed first, in which case both are null;
- `skeletonSeen: false`;
- `endsUnpending: true`.

Expected for **page-change** rows (sidebar): `skeletonSeen: true`, `currentOnFirstFrame` includes the new sidebar label, and `endsUnpending: true`.

Walk and record results for:

| # | Start URL | Click | Kind |
|---|---|---|---|
| 1 | `/` | sidebar "Customers" | page change |
| 2 | `/customers` | sidebar "Funnel" | page change |
| 3 | `/funnel` | sidebar "Ads" | page change |
| 4 | `/ads` | sidebar "Overview" | page change |
| 5 | `/settings/users` | sidebar "Overview" | page change |
| 6 | `/?range=30d` | "All time" pill | same page, pill instant |
| 7 | `/ads?tab=campaigns&range=30d` | tab "Ads" | same page, tab instant |
| 8 | `/ads?tab=campaigns&range=30d` | first campaign row | same page |
| 9 | `/customers?tab=value&range=30d` | tab "People" | same page, tab instant |
| 10 | `/customers?tab=people&range=30d` | a sortable column header | same page |
| 11 | `/customers?tab=people&range=30d` | first person row (opens sheet) | same page |
| 12 | `/customers?tab=people&range=30d` | "Record payment" | same page |
| 13 | `/funnel?lens=campaign&range=30d` | lens "Landing page" | same page, tab instant |
| 14 | `/funnel?lens=campaign&range=30d` | first drillable campaign | same page |
| 15 | `/?range=30d` | "Open a day…" select → pick a day | same page |
| 16 | `/` | client switcher → the other client | same page, name instant |

Take a `browser_take_screenshot` for row 6 at ~600 ms after the click (dimmed + bar), for row 1 at ~100 ms (skeleton), and for each final state. Save them to the scratchpad.

- [ ] **Step 3: The no-flicker check (fast responses show nothing)**

```js
async (page) => {
  await page.goto("http://localhost:3100/");
  await page.waitForSelector(".pending-content h1");
  return page.evaluate(async () => {
    const region = document.querySelector(".pending-region");
    const content = document.querySelector(".pending-content");
    const bar = document.querySelector(".pending-bar");
    region.setAttribute("data-pending", "");
    await new Promise((r) => setTimeout(r, 100));
    const at100 = { opacity: getComputedStyle(content).opacity, bar: getComputedStyle(bar).opacity };
    region.removeAttribute("data-pending");
    return at100;
  });
}
```

Expected: `{ opacity: "1", bar: "0" }`. Inside the delays, nothing has changed visually.

- [ ] **Step 4: Review Focus checks**

1. **Modifier-click.** On `/`, `page.getByRole("link", { name: "Customers" }).click({ modifiers: ["Meta"] })`, then `page.context().pages().length`, and `.pending-region` `data-pending` 50 ms later. Expect 2 pages and no `data-pending`. Close the extra page.
2. **Quick double-click.** On `/?range=30d`, run `__probe()`, click "Last 7 days" then, after 100 ms, "All time". After 8 s: `finalCurrent` includes "All time", `endsUnpending: true`, and the URL contains `range=all`.
3. **Back/forward.** After check 2, call `page.goBack()` and wait 5 s. Expect the pressed pill to match the URL's `range`, and `data-pending` to be absent. Then `page.goForward()` and the same check.
4. **Scrolled long page.** On `/customers?tab=people&range=all`, `window.scrollTo(0, document.body.scrollHeight)`, run `__probe()`, then click a sortable column header or the next-page control. Take a screenshot at ~600 ms. Expect the bar visible at the top of the viewport (`barAt` not null) and `.pending-bar`'s `getBoundingClientRect().top === 0`.
5. **Server error → `error.tsx`.**
   - Temporarily add `if (first(params.range) === "explode") throw new Error("verify error boundary");` as the first line after `const params = await searchParams;` in `src/app/(dashboard)/funnel/page.tsx`. `first` is already defined in that file.
   - Rebuild and restart.
   - From `/funnel?range=30d`, navigate with `page.goto` to `/funnel?range=explode`. Expect "This page didn't load" and the sidebar still visible.
   - Click a sidebar item. Expect a normal navigation.
   - **Revert the temporary line**: `git checkout -- "src/app/(dashboard)/funnel/page.tsx"`. Confirm with `git diff --stat` that the file is clean.
   - Rebuild.
6. **Reduced motion.** Run `page.emulateMedia({ reducedMotion: "reduce" })`, then repeat row 6 and take a screenshot. Expect the bar as a still full-width line and no pulse animation on skeletons (`getComputedStyle(el).animationName === "none"` on a `[data-skeleton] .animate-pulse` element during row 1).
7. **Console.** `browser_console_messages` must show no errors across the walk, apart from the deliberate one in check 5.

If any check fails, fix it in the task that owns the code, re-run that task's tests, and then continue the walk. Stop the server at the end.

- [ ] **Step 5: Document the rule**

In `docs/design-system/trace-design-system.md` §4, replace the bullet `- **Loading:** \`Loader2\`/\`CircleDashed\` with \`animate-spin\`; buttons also get \`disabled:opacity-60\` and a progressive label.` with:

```markdown
- **Loading — buttons:** `Loader2`/`CircleDashed` with `animate-spin`; buttons also get `disabled:opacity-60` and a progressive label. Icon-only form buttons use `SubmitIconButton` (icon → spinner via `useFormStatus`).
- **Loading — navigation (2026-10-05, `docs/superpowers/specs/2026-10-05-instant-feedback-design.md`):** every click is acknowledged at once.
  - *Same-page changes* (filters, tabs, rows, client switch): the control switches on click (read active state from `useDestination()`); content fades to `--pending-opacity` after `--pending-dim-delay` (150ms) and a 2px indigo bar runs after `--pending-bar-delay` (400ms); fast responses show neither.
  - *Page changes*: the route's `loading.tsx` skeleton, built from `@/components/page-skeleton`, with the page's real title; gentle pulse, never shimmer, still under reduced motion.
  - In dashboard code never import `next/link` or `useRouter` — use `PendingLink` / `usePendingRouter` / `useRunPending` from `@/components/navigation/pending-navigation`. Every dashboard page needs its own `loading.tsx`. Both are enforced by `tests/pending-navigation-guard.test.ts`.
```

- [ ] **Step 6: Record it in STATUS**

In `docs/STATUS.md`, add a checklist entry after the most recent `- [x]` entry in the phase checklist:

```markdown
- [x] **Instant feedback on every click** (2026-10-05; spec `docs/superpowers/specs/2026-10-05-instant-feedback-design.md`, plan `docs/superpowers/plans/2026-10-05-instant-feedback-implementation.md`). Clicks used to give no sign of life for 2–3 s. First the region pin (`6132c3d`, functions `iad1` → `bom1`): Ads → Ads 10.3s → 3.3s median full-page load. Then a shared pending layer (`src/components/navigation/pending-navigation.tsx`): one `startTransition` for the shell, so controls show the clicked state on click; same-page changes fade the content after 150ms and run a 2px indigo bar after 400ms; page changes show a per-route `loading.tsx` skeleton (Overview moved into an `(overview)` route group so it has its own boundary). Plus a dashboard `error.tsx` (`unstable_retry`), spinners on sign-out/remove-user, and `tests/pending-navigation-guard.test.ts` (no direct `next/link`/`useRouter` in dashboard code; every page has a `loading.tsx`). Still open: sheets opening instantly with their own skeleton; server time on Overview/Funnel (database, not distance — measure the RPCs first).
```

- [ ] **Step 7: Final suite and commit**

Run: `npm run typecheck && npm test`
Expected: clean and green.

```bash
git add docs/design-system/trace-design-system.md docs/STATUS.md
git commit -m "docs: loading & pending rules; STATUS entry for instant feedback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Report to Sharan with the walk table (all 16 rows), the Review Focus results, and the screenshots. Don't push: deploying is Sharan's call.

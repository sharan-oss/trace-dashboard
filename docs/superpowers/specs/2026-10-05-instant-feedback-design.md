# Instant feedback on every click — design

**Date:** 2026-10-05 · **Status:** draft for Sharan's review · **Scope:** "B" of the loading-state work (A — the `bom1` region pin — shipped as `6132c3d`; C — query speed for Overview/Funnel — is separate and later).

## Problem

Clicking anything in the dashboard gives no sign it registered. The old view stays frozen until the server has rendered the whole new one, then everything jumps at once. Measured full-page loads after the region pin, median of 4: Overview ~3.2s, Ads ~3.2s, Funnel ~4.3s, Customers ~1.2s, Sync log ~0.5s.

Why, from the code (2026-10-05 survey):

- Only `/ads` has a `loading.tsx`. Next 16 does not prefetch a dynamic route without one, and "the client must wait for the server response before showing the result" (Next docs, *Linking and Navigating*). The other five routes have nothing to show in the meantime.
- Every filter, tab, date range and row click is a `router.push`/`replace` or `<Link>` to a new search param. Next runs these as React transitions, which keep the old UI on screen and expose no pending signal unless the caller asks for one. No control does.
- The active state of the sidebar, tabs and date pills is derived from server props or `usePathname()`, so it only moves after the new page arrives.
- There is no `error.tsx` anywhere in the dashboard.

## Goal and success criteria

Every click is acknowledged at once, and a wait always shows that something is loading. Concretely:

1. The clicked control (sidebar item, tab, date pill, client name) shows its new state in the same frame as the click.
2. If the response takes more than 150 ms, the stale content fades. Past 400 ms, a progress bar runs.
3. If the response comes back faster than that, neither indicator appears, so there is no flicker.
4. Moving to a different page shows that page's skeleton immediately.
5. A failed load shows an error with a retry, never a page stuck faded.
6. New code can't quietly bypass this: a test fails if it does.

This round does not make the server faster. That is C.

## Decisions (made with Sharan, 2026-10-05, from live mockups)

- **Same-page changes (filters, tabs, rows, client switch) → "D": dim + bar.** The control switches instantly. After 150 ms the content fades to 55% opacity. After 400 ms a 2 px indigo bar slides across the top of the content area.
- **Page changes (sidebar) → "A": a pulse skeleton.** The new page's frame appears at once with its real title. Placeholders pulse gently; no shimmer, which research flagged as distracting on dark glass UIs. The skeleton is the signal, so the bar does not also run.
- **Built in-house. No progress-bar library.**
  - Libraries such as `nextjs-toploader` and `@bprogress/next` only see link clicks. They miss search-param filters and server-action refreshes.
  - A bar on its own still leaves the page frozen.
  - The pattern used here is the one Next's own docs point to (`vercel/react-transition-progress`): wrap navigation in our own `startTransition`, then read `isPending`.
- **Skipped:**
  - Cache Components / PPR: a new caching model with build-time errors.
  - `staleTimes`: the docs call it "not recommended for production".
  - Client data caches (SWR, React Query).
  - A Linear-style local sync engine.

## Design

### Units

**1. `src/components/navigation/pending-navigation.tsx`** (client): the only place that knows a click is in flight.

- `PendingNavigationProvider({ children })`
  - Owns one `useTransition()` and one `useOptimistic<string | null>(null)`, which holds the destination href.
  - Wraps the whole app shell, because sidebar controls sit outside `<main>`.
- `usePendingRouter(): { push(href, opts?), replace(href, opts?), refresh() }`
  - Each call runs inside the shared transition.
  - `push` and `replace` also set the optimistic destination.
  - Options pass straight through to Next's router (`{ scroll }`).
- `useDestination(): URL` — the URL being navigated to while pending, otherwise the current one (`usePathname()` + `useSearchParams()`).
  - Controls derive their *active* state from this; that is what makes them switch instantly.
  - React reverts it automatically once the transition settles, by which time the real URL already matches.
- `runPending(fn: () => void | Promise<void>)`
  - Runs an arbitrary async function, such as a server action, inside the shared transition.
  - The caller may update its own `useOptimistic` state inside `fn`.
- `usePendingState(): boolean` — `isPending`, for components that want it.
- `<PendingLink href replace? scroll? …>`
  - A drop-in for `next/link`. It renders a real `<Link>`, so prefetching and modifier-click behaviour are untouched.
  - Its `onNavigate` (documented in Next 16's `link.md`, fired only for in-app navigation, never for ctrl- or cmd-click) calls `e.preventDefault()` and then `push`/`replace` through the shared transition.
  - `href` is `string` only. Every current usage is already a string.

**2. `PendingRegion`** (client, same file): wraps `{children}` inside `<main>` in `AppShell`.

- Renders `<div className="pending-region" data-pending={isPending || undefined} aria-busy={isPending}>`.
- Contains the progress bar element and a `.pending-content` wrapper around the children.
- All visuals are CSS, below.

**3. CSS in `src/app/globals.css`**, with tokens on `:root`, never hard-coded in components:

```css
--pending-opacity: 0.55;
--pending-dim-delay: 150ms;
--pending-bar-delay: 400ms;
```

- `.pending-content`
  - Always has `transition: opacity 200ms`.
  - Under `[data-pending]`, opacity becomes `var(--pending-opacity)` with `transition-delay: var(--pending-dim-delay)`.
  - Removing the attribute un-dims at once, with no delay on the way back.
- `.pending-bar`
  - 2 px, absolutely positioned at the top of the region, `pointer-events: none`.
  - An indigo-to-indigo-300 gradient segment slides across over 1.1 s, infinitely.
  - Opacity goes 0 → 1 under `[data-pending]` after `var(--pending-bar-delay)`.
  - Must stay visible when the page is scrolled. It is `position: fixed` at the top of the viewport, inset by the sidebar's width (`sm:left-60`, mirroring AppShell's `sm:w-60`). Not `sticky`: `<main>` is `overflow-auto`, so a sticky bar would pin to `<main>`, which never scrolls, and would scroll away with the window. (Corrected while planning.)
- `@media (prefers-reduced-motion: reduce)`: the bar is a static full-width line at 70% and skeletons don't pulse.
- Follows the design system: indigo is the action colour and there are no shadows.

**4. `src/components/ui/skeleton.tsx`**

- `Skeleton({ className })` renders a `div` with `animate-pulse motion-reduce:animate-none rounded bg-white/10`, plus `aria-hidden`.
- The existing `ads/loading.tsx` is refactored onto it, with the same look as today.

**5. Five new `loading.tsx` files**, one per route without one:

- `(dashboard)/(overview)/loading.tsx` (Overview), `customers/loading.tsx`, `funnel/loading.tsx`, `ads/sync-log/loading.tsx`, `settings/users/loading.tsx`.
- The Overview page moves into a `(overview)` route group (`git mv src/app/(dashboard)/page.tsx src/app/(dashboard)/(overview)/page.tsx`); the URL is unchanged. (Corrected while planning.)
  - A `loading.tsx` placed directly in `(dashboard)/` would wrap the layout's whole `children`. That boundary is already revealed whenever any dashboard page is on screen, so a transition back to `/` would keep the old page and never show the Overview skeleton.
  - The route group gives `/` a boundary of its own, like every other page.

Each one:
- Mirrors its page's top-level layout with the same `BentoGrid`/`BentoTile`/card classes.
- Shows the real `<h1>` text.
- Uses `Skeleton` blocks where data would be.
- Carries `aria-busy="true"` on the wrapper.
- Reserves the real heights so the page doesn't shift when the data lands.

No `loading.tsx` sits directly in `(dashboard)/`. The guard test (below) asserts that every dashboard page has its own.

**6. `src/app/(dashboard)/error.tsx`** (client)

- A glass card: "This page didn't load" and one plain sentence, then a **Try again** button that calls `unstable_retry()`. That is Next 16's API; `reset()` is the legacy one.
- Shows `error.digest` in small mono text when present, so a report can be matched to logs.
- It sits under the layout, so the sidebar stays usable.
- Layout-level failures (the auth gate, `AppShell`'s client list) are out of scope here and still go to Next's default.

### Wiring

- `AppShell` wraps its returned tree in `<PendingNavigationProvider>`, and wraps `{children}` inside `<main>` in `<PendingRegion>`.
  - `AppShell` remains a server component; both new components are client components taking `children`.
- Controls switch from `next/link` → `PendingLink` and from `useRouter` → `usePendingRouter`.
- Their active state switches from server props or `usePathname()` → `useDestination()`, where the table below says so.

| File | Change | Active state from `useDestination` |
|---|---|---|
| `components/sidebar-nav.tsx` | `PendingLink` | yes — highlight |
| `components/client-switcher.tsx` | `runPending` + local `useOptimistic(selectedId)` | yes — name + check (optimistic id) |
| `components/date-range-picker.tsx` | `usePendingRouter` | yes — preset pill, parsed from destination params with the existing `parseRangeState` |
| `components/ads/ads-tabs.tsx` | `PendingLink` (becomes a client component) | yes — tab |
| `components/ads/campaigns-table.tsx` | `usePendingRouter` + `PendingLink` | — |
| `components/ads/ad-cards.tsx` | `usePendingRouter` (campaign select) | — (native select is already instant) |
| `components/ads/sync-now-button.tsx` | `usePendingRouter().refresh` | — (keeps its own progress label) |
| `app/(dashboard)/ads/page.tsx`, `ads/sync-log/page.tsx`, `customers/page.tsx` | `PendingLink` | — |
| `components/customers/customers-tabs.tsx` | `PendingLink` | yes — tab |
| `components/customers/people-table.tsx` | `usePendingRouter` + `PendingLink` | — (inputs are local state already) |
| `components/customers/customer-sheet.tsx`, `record-payment-sheet.tsx` | `usePendingRouter` + `PendingLink` (close, record link) | — |
| `components/funnel/funnel-segments.tsx` | `PendingLink` | yes — lens tab |
| `components/overview/revenue-chart-card.tsx` | `usePendingRouter` (day click, "Open a day…") | — |
| `components/overview/day-detail-sheet.tsx` | `usePendingRouter` + `PendingLink` | — |
| `components/overview/top-ads-table.tsx` | `PendingLink` | — |
| `app/(dashboard)/settings/users/page.tsx` | Remove button → small client `SubmitButton` using `useFormStatus` ("Removing…") | — |
| `components/account-menu.tsx` | Sign out → same `SubmitButton` ("Signing out…") | — |

Unchanged:
- Already instant (local state): the Ads-view local filters and the chart metric tabs.
- Already have pending UI: Record payment, Void, Add user, the customer combobox and Sync now's own label.

### Guard

`tests/pending-navigation-guard.test.ts` runs in Node and is read-only.

- It walks `src/**/*.tsx`. It fails on any file that imports from `next/link`, or imports `useRouter` from `next/navigation`, outside an allowlist:
  - `components/navigation/pending-navigation.tsx`
  - `app/(auth)/**`
  - `app/auth/**`
  - `app/(marketing)/**`
  - `app/new/**`
- A second assertion fails if any `app/(dashboard)/**/page.tsx` lacks a sibling `loading.tsx`.
- Both failure messages say what to use instead.

### Error handling and edge cases

- **Rapid clicks.** Each new navigation starts a new transition. `isPending` stays true and the latest destination wins, which is Next's router behaviour, and the optimistic destination tracks it.
- **Back/forward.** The browser's popstate isn't ours, so there is no dim. Next restores from its router cache, which is usually instant.
- **A failed navigation or server action.** The transition ends, so the dim lifts and `error.tsx` renders for page errors. Server actions keep their existing inline error handling.
- **People search debounce.** The input stays responsive (local state). Only the table region fades while results load.

## Verification

1. **Assumption check (first task, before anything else is built).**
   - On `next build && next start`, because prefetching is off in dev, prove both of these:
     - (a) A search-param change wrapped in our transition keeps the current page faded and does **not** flash its `loading.tsx`.
     - (b) `isPending` stays true until the new data has rendered.
   - Prove them with a throwaway page or by instrumenting one real control. If either fails, stop and bring it back to Sharan.
2. **`npm run typecheck`**, plus the full **`npm test`** suite including the new guard test.
3. **A Playwright walk on a production build, with network throttling.** For every row of the wiring table:
   - The control switches within one frame.
   - `data-pending` is set; the fade is visible at about 150 ms and the bar at about 400 ms.
   - Unthrottled fast responses show neither.
   - Sidebar navigation shows the skeleton first.
   - A forced server error renders `error.tsx`, and **Try again** recovers it.
   - Under emulated `prefers-reduced-motion` the bar is static and skeletons don't pulse.
   - No console errors.
4. Screenshots of each state for Sharan.

## Docs

- `docs/design-system/trace-design-system.md` gains a **Loading & pending** section:
  - the D/A rule and the three tokens;
  - "never call `router` or `<Link>` directly in the dashboard";
  - the skeleton rule.
- `docs/STATUS.md` records the change.

## Out of scope / follow-ups

- **Sheets that open instantly** with their own skeleton (customer, day, record payment): today a row click fades the page and the sheet appears when it is ready. This is the natural next step.
- **C — server speed** for Overview and Funnel: database time, not distance. Measure the RPCs first.
- **Error boundaries** at layout level or global (`global-error.tsx`).

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

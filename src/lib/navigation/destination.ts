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

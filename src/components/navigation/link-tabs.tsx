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

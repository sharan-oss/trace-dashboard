import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RangePreset } from "@/lib/range";

export type CustomersTab = "value" | "people";

/**
 * The Customers section's two sub-views. Value is the economics argument;
 * People is the individuals behind it. Plain links so tab state lives in the
 * URL and stays shareable — and switching tabs deliberately drops the
 * People-only params (search, sort, page, open customer), which mean nothing
 * on the other side.
 */
export function CustomersTabs({
  active,
  range,
}: {
  active: CustomersTab;
  range: RangePreset;
}) {
  const tabs: { key: CustomersTab; label: string; href: string }[] = [
    { key: "value", label: "Value", href: `/customers?tab=value&range=${range}` },
    { key: "people", label: "People", href: `/customers?tab=people&range=${range}` },
  ];
  return (
    <nav
      aria-label="Customers section views"
      className="inline-flex w-fit items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "rounded-md px-4 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
            active === tab.key
              ? "bg-accent text-accent-foreground"
              : "text-slate-400 hover:text-white",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

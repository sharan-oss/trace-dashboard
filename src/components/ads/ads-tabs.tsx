import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RangePreset } from "@/lib/range";

export type AdsTab = "campaigns" | "ads";

/**
 * The Ads section's two sub-views — Campaigns | Ads, Meta Ads Manager's own
 * names. Plain links, so tab state lives in the URL (?tab=) and stays
 * shareable; switching back to Campaigns deliberately drops any ?campaign=
 * filter, which only means something inside the Ads view.
 */
export function AdsTabs({ active, range }: { active: AdsTab; range: RangePreset }) {
  const tabs: { key: AdsTab; label: string; href: string }[] = [
    { key: "campaigns", label: "Campaigns", href: `/ads?tab=campaigns&range=${range}` },
    { key: "ads", label: "Ads", href: `/ads?tab=ads&range=${range}` },
  ];
  return (
    <nav
      aria-label="Ads section views"
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

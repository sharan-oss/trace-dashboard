"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RANGE_OPTIONS, type RangePreset } from "@/lib/range";
import { cn } from "@/lib/utils";

/** Three-preset segmented control; the choice travels as ?range= so views
 * stay shareable and back/forward-friendly. Only the range key is touched —
 * other params (e.g. the Ads section's ?tab= and ?campaign=) must survive. */
export function DateRangePicker({ value }: { value: RangePreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              params.set("range", option.value);
              router.replace(`${pathname}?${params.toString()}`, {
                scroll: false,
              });
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-slate-400 hover:text-white",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

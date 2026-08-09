"use client";

import { usePathname, useRouter } from "next/navigation";
import { RANGE_OPTIONS, type RangePreset } from "@/lib/range";
import { cn } from "@/lib/utils";

/** Three-preset segmented control; the choice travels as ?range= so views
 * stay shareable and back/forward-friendly. */
export function DateRangePicker({ value }: { value: RangePreset }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              router.replace(`${pathname}?range=${option.value}`, {
                scroll: false,
              })
            }
            className={cn(
              "rounded-[5px] px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

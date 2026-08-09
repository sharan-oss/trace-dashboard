import { Lock, type LucideIcon } from "lucide-react";
import { BentoTile } from "@/components/ui/bento-tile";
import { cn } from "@/lib/utils";

/**
 * Overview KPI tile — a dashboard-specific extension of the design system
 * (recorded in the v2 spec): eyebrow label + icon chip row, then a large
 * numeral. `hero` marks the tiles that carry the headline story (L1/L2
 * revenue) with the indigo highlight; `locked` renders Meta-derived
 * placeholders as dormant — ghost dash and a lock chip — never fake zeros.
 */
export function KpiTile({
  label,
  value,
  valueSuffix,
  caption,
  locked = false,
  hero = false,
  icon: Icon,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
  caption?: string;
  locked?: boolean;
  hero?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <BentoTile
      className={cn(
        "flex flex-col justify-between gap-5",
        hero && "border-indigo-500/30 bg-indigo-500/6",
        locked && "border-border/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          {label}
        </p>
        {(Icon != null || locked) && (
          <span
            className={cn(
              "rounded-lg border border-border bg-white/5 p-2",
              locked ? "text-slate-600" : "text-indigo-400",
            )}
          >
            {locked ? (
              <Lock size={15} aria-hidden="true" />
            ) : (
              Icon != null && <Icon size={15} aria-hidden="true" />
            )}
          </span>
        )}
      </div>
      <div>
        <p
          className={cn(
            "font-heading text-4xl font-bold tracking-tight tabular-nums",
            locked ? "text-white/25" : "text-white",
          )}
        >
          {value}
          {valueSuffix != null && (
            <span className="ml-1.5 text-base font-normal text-slate-400">
              {valueSuffix}
            </span>
          )}
        </p>
        {caption != null && (
          <p className="mt-1.5 text-xs text-slate-500">{caption}</p>
        )}
      </div>
    </BentoTile>
  );
}

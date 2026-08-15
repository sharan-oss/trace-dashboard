import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCount, formatPercent } from "@/lib/format";
import {
  biggestLeak,
  FUNNEL_STAGES,
  type StageCounts,
} from "@/lib/metrics/funnel-stages";
import type { FunnelOverview } from "@/lib/queries/funnel";
import { cn } from "@/lib/utils";

/**
 * The stage funnel: six horizontal bars, each "reached this stage or beyond",
 * so widths are monotonically non-increasing by construction (the view
 * guarantees it; the test suite asserts it).
 *
 * The callout on top does the reading for the reader: the single largest
 * relative drop between adjacent stages, as a sentence. Dead traffic (sessions
 * that never loaded) is deliberately not a candidate — it is not a step a
 * visitor abandoned, and it has its own strip below.
 *
 * Color: Paid is the indigo-400 hero; every prior stage is the slate baseline
 * — the same emphasis rule as the revenue chart. A min-width floor keeps late
 * stages visible: 469 of 10,683 would otherwise be a 4px sliver.
 */
export function FunnelStages({ overview }: { overview: FunnelOverview }) {
  const counts: StageCounts = {
    reached_page_load: overview.reached_page_load,
    reached_form_open: overview.reached_form_open,
    reached_form_start: overview.reached_form_start,
    reached_form_submit: overview.reached_form_submit,
    reached_payment_open: overview.reached_payment_open,
    reached_payment_complete: overview.reached_payment_complete,
  };
  const leak = biggestLeak(counts);
  const max = overview.reached_page_load;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          Where visitors leak
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          Each stage counts sessions that reached it or any later stage
        </CardDescription>
      </CardHeader>
      <CardContent>
        {max <= 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No sessions reached the page in this range.
          </p>
        ) : (
          <>
            {leak != null && (
              <p className="mb-5 rounded-xl border border-indigo-500/30 bg-indigo-500/6 px-4 py-3 text-sm text-slate-300">
                <span className="font-heading text-lg font-bold text-white tabular-nums">
                  {formatPercent(leak.lostShare)}
                </span>{" "}
                of visitors at{" "}
                <span className="font-medium text-white">{leak.fromLabel}</span>{" "}
                never {leak.lossVerb} — the biggest leak in this funnel.
              </p>
            )}

            <ol className="flex flex-col gap-1.5">
              {FUNNEL_STAGES.map((stage, i) => {
                const value = counts[stage.key];
                const prev = i === 0 ? null : counts[FUNNEL_STAGES[i - 1].key];
                const widthPct = Math.max((value / max) * 100, 1.5);
                const isPaid = stage.key === "reached_payment_complete";
                const dropShare =
                  prev != null && prev > 0 ? (prev - value) / prev : null;
                return (
                  <li key={stage.key}>
                    {dropShare != null && dropShare > 0 && (
                      <p className="py-0.5 pl-2 text-[11px] text-slate-600 tabular-nums">
                        ↓ {formatPercent(dropShare)} drop
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-right text-xs text-slate-400">
                        {stage.label}
                      </span>
                      <div className="relative h-8 min-w-0 flex-1">
                        <div
                          className={cn(
                            "flex h-full items-center rounded-md",
                            isPaid ? "bg-indigo-400/70" : "bg-slate-400/20",
                          )}
                          style={{ width: `${widthPct}%` }}
                        />
                        <span
                          className={cn(
                            "absolute inset-y-0 flex items-center text-xs tabular-nums",
                            // Label sits inside wide bars, outside narrow ones.
                            widthPct > 42
                              ? "left-3 font-medium text-white"
                              : "text-slate-300",
                          )}
                          style={
                            widthPct > 42
                              ? undefined
                              : { left: `calc(${widthPct}% + 10px)` }
                          }
                        >
                          {formatCount(value)}
                          <span className="ml-1.5 text-slate-500">
                            ({formatPercent(value / overview.sessions)} of sessions)
                          </span>
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { MousePointerBan, SignalZero } from "lucide-react";
import { formatCount, formatPercent } from "@/lib/format";
import type { FunnelOverview } from "@/lib/queries/funnel";

/**
 * The dead-traffic strip: clicks that were paid for and produced nothing.
 *
 * Two facts, counts not accusations:
 *  - sessions that never fired page_load — the click happened, the page never
 *    rendered (8.4% for Love School when this shipped);
 *  - sessions that sent no telemetry at all, with their conversion count taken
 *    from the RPC rather than assumed — live it is exactly zero, which is the
 *    signature of bot/junk traffic, but if it ever stops being zero the strip
 *    says so instead of lying.
 *
 * Renders nothing when both counts are zero: an empty warning is noise.
 */
export function WastedClicksStrip({ overview }: { overview: FunnelOverview }) {
  const { sessions, never_loaded, no_telemetry, no_telemetry_converted } = overview;
  if (sessions <= 0 || (never_loaded <= 0 && no_telemetry <= 0)) return null;

  return (
    <div className="flex flex-col gap-x-8 gap-y-2 rounded-xl border border-border bg-white/5 px-4 py-3 backdrop-blur-md sm:flex-row sm:items-center">
      {never_loaded > 0 && (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <MousePointerBan size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            <span className="font-semibold text-white tabular-nums">
              {formatCount(never_loaded)}
            </span>{" "}
            sessions ({formatPercent(never_loaded / sessions)}) ended before the
            page rendered — paid clicks that never became visitors.
          </span>
        </p>
      )}
      {no_telemetry > 0 && (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <SignalZero size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span>
            <span className="font-semibold text-white tabular-nums">
              {formatCount(no_telemetry)}
            </span>{" "}
            sessions sent no device telemetry;{" "}
            {no_telemetry_converted === 0 ? (
              <>none converted.</>
            ) : (
              <>{formatCount(no_telemetry_converted)} converted.</>
            )}
          </span>
        </p>
      )}
    </div>
  );
}

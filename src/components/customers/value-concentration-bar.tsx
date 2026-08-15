import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCount, formatINR, formatPercent } from "@/lib/format";

/**
 * The single most important object on this page: one bar splitting revenue into
 * the first purchase every customer makes and everything they buy afterwards.
 *
 * For both live clients that split is roughly 35/65 — a ~Rs 99 tripwire against
 * a high-ticket upsell landing about three days later — which means the ads are
 * not being bought for the first sale at all. A time series would bury that; one
 * bar states it. Overview already owns revenue-over-time, so this deliberately
 * is not a chart.
 *
 * Colour follows the chart palette: slate-400 is the baseline (first purchases),
 * indigo-400 is the hero (repeat revenue, the story). Same emphasis inversion
 * the Overview chart uses — the smaller count carries the larger colour because
 * it carries the larger truth.
 */
export function ValueConcentrationBar({
  firstPaise,
  firstPurchases,
  repeatPaise,
  repeatPurchases,
  totalPaise,
  repeatCustomers,
  totalCustomers,
}: {
  firstPaise: number;
  firstPurchases: number;
  repeatPaise: number;
  repeatPurchases: number;
  totalPaise: number;
  repeatCustomers: number;
  totalCustomers: number;
}) {
  const hasRevenue = totalPaise > 0;
  const repeatShare = hasRevenue ? repeatPaise / totalPaise : 0;
  const customerShare = totalCustomers > 0 ? repeatCustomers / totalCustomers : 0;

  // Keep both segments visible once they carry any money at all: a segment
  // rounded to a hairline would read as "nothing here" when it is not.
  const repeatPct = hasRevenue
    ? Math.min(Math.max(repeatShare * 100, repeatPaise > 0 ? 2 : 0), 98)
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          Where the revenue comes from
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          Every purchase this cohort has made, split into the first one and
          everything after it
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasRevenue ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No revenue from customers acquired in this range yet.
          </p>
        ) : (
          <>
            <div
              className="flex h-11 w-full overflow-hidden rounded-lg border border-white/10"
              role="img"
              aria-label={`First purchases ${formatINR(firstPaise)}, repeat purchases ${formatINR(repeatPaise)}`}
            >
              <div
                className="flex items-center bg-slate-400/25"
                style={{ width: `${100 - repeatPct}%` }}
              />
              <div
                className="flex items-center bg-indigo-400/70"
                style={{ width: `${repeatPct}%` }}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
              <Legend
                swatch="bg-slate-400/25"
                label="First purchases"
                value={formatINR(firstPaise)}
                sub={`${formatCount(firstPurchases)} purchases`}
              />
              <Legend
                swatch="bg-indigo-400/70"
                label="Repeat purchases"
                value={formatINR(repeatPaise)}
                sub={`${formatCount(repeatPurchases)} purchases`}
                align="right"
              />
            </div>

            {repeatCustomers > 0 && (
              <p className="mt-5 border-t border-white/10 pt-4 text-sm text-slate-300">
                <span className="font-semibold text-white">
                  {formatPercent(customerShare)}
                </span>{" "}
                of customers produce{" "}
                <span className="font-semibold text-indigo-300">
                  {formatPercent(repeatShare)}
                </span>{" "}
                of revenue.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Legend({
  swatch,
  label,
  value,
  sub,
  align = "left",
}: {
  swatch: string;
  label: string;
  value: string;
  sub: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <div
        className={`flex items-center gap-2 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        <span className={`size-2.5 shrink-0 rounded-sm ${swatch}`} aria-hidden="true" />
        <span className="text-xs font-medium text-slate-400">{label}</span>
      </div>
      <p className="mt-1 font-heading text-xl font-bold tracking-tight text-white tabular-nums">
        {value}
      </p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

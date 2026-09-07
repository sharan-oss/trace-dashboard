"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDayShort, formatINR, formatINRCompact } from "@/lib/format";
import type { RevenueDailyRow } from "@/lib/queries/overview";
import { cn } from "@/lib/utils";

/**
 * The Overview chart card. Three live tabs since Slice D — Spends | Revenue |
 * CPA — all Meta-backed now that the sync runs nightly.
 *
 * Series palette (decided 2026-08-10, design system v2): on the Revenue tab
 * L2 is the hero line in indigo (chart-1) at 2px — the 1.6x acquisition
 * story — and L1 is the slate baseline (chart-2) at 1.5px. The single-series
 * tabs reuse chart-1. Two series max per tab; the >2-series categorical
 * palette decision stays open.
 *
 * CPA points are null on zero-buyer days — the line breaks rather than
 * drawing a zero that reads as "free customers".
 */

export type OverviewChartRow = RevenueDailyRow & {
  spend_paise: number;
  cpa_paise: number | null;
};

type Tab = "spends" | "revenue" | "cpa";

const revenueConfig = {
  l2_revenue_paise: { label: "L2 revenue", color: "var(--chart-1)" },
  l1_revenue_paise: { label: "L1 revenue", color: "var(--chart-2)" },
} satisfies ChartConfig;

const spendConfig = {
  spend_paise: { label: "Meta spend", color: "var(--chart-1)" },
} satisfies ChartConfig;

const cpaConfig = {
  cpa_paise: { label: "CPA (L1)", color: "var(--chart-1)" },
} satisfies ChartConfig;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "spends", label: "Spends" },
  { id: "revenue", label: "L1 + L2 Revenue" },
  { id: "cpa", label: "CPA" },
];

const COPY: Record<Tab, { title: string; description: string }> = {
  revenue: {
    title: "Revenue",
    description: "Daily L1 and L2 revenue — click a day for the payments behind it",
  },
  spends: {
    title: "Meta spend",
    description: "Daily spend reported by Meta across connected ad accounts",
  },
  cpa: {
    title: "CPA (L1)",
    description:
      "Daily Meta spend per new L1 buyer — gaps are days with no buyers",
  },
};

const dayTick = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatDay(day: unknown): string {
  const t = Date.parse(`${String(day)}T00:00:00Z`);
  return Number.isNaN(t) ? String(day) : dayTick.format(t);
}

/**
 * The hover cursor on the drillable tab: a full-height band the width of the
 * day's catchment, plus a centre hairline.
 *
 * WHY A BAND. Recharts draws a bare 1px hairline on a LineChart and a full
 * band on a BarChart (`Cursor.js` falls through to `Curve` for anything that
 * is not a BarChart). A *drillable* line chart needs the band, because the
 * click target is the whole vertical strip and painting it is the only honest
 * way to say so. The alternative — a hint telling people to travel to the
 * tooltip — is what this chart got wrong first: the tooltip is
 * `pointerEvents: 'none'` by design (it would otherwise steal its own
 * trigger's mouseleave and strobe), so a call to action inside it points at a
 * target nobody can reach, and the attempt to reach it re-triggers hover on
 * the days in between. Grafana's design system states the general rule --
 * interactive components do not belong inside a tooltip -- and their
 * actions-discoverability issue is still open. So the affordance has to be
 * painted where the click actually lands. Vercel's v0 chart and the
 * interaction-design literature converge on the same "floor to ceiling
 * column" target.
 *
 * The width is the REAL catchment, not decoration: on a point scale the gap
 * between adjacent days is width/(count-1), and Recharts activates the nearest
 * index, so half that gap either side is exactly the region that opens this
 * day. The hairline stays because it is what reads the date precisely; the
 * band is what says "this whole strip is one thing you can click".
 *
 * Recharts clones this element with the cursor props, which is where `points`
 * and the plot geometry arrive from.
 */
function DayColumnCursor({
  points,
  top,
  left,
  width,
  height,
  count,
}: {
  points?: Array<{ x: number; y: number }>;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  /** Plotted days — the catchment denominator. */
  count: number;
}) {
  const x = points?.[0]?.x;
  if (x == null || top == null || left == null || width == null || height == null) {
    return null;
  }
  const band = count > 1 ? width / (count - 1) : width;
  // Clamped, so the first and last day get a half band inside the plot rather
  // than one hanging over the axis.
  const bandX = Math.max(left, x - band / 2);
  const bandW = Math.min(left + width, x + band / 2) - bandX;
  return (
    // pointerEvents none throughout: the band must never eat the click it is
    // advertising, nor interrupt the hover that draws it.
    <g pointerEvents="none">
      <rect
        x={bandX}
        y={top}
        width={bandW}
        height={height}
        fill="var(--chart-1)"
        fillOpacity={0.1}
      />
      <line
        x1={x}
        y1={top}
        x2={x}
        y2={top + height}
        stroke="var(--chart-1)"
        strokeOpacity={0.45}
        strokeWidth={1}
      />
    </g>
  );
}

export function RevenueChartCard({
  data,
  l2WindowLabel = null,
}: {
  data: OverviewChartRow[];
  /** Set only in split-window mode; the revenue tab then says which window L2 covers. */
  l2WindowLabel?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("revenue");
  const config: ChartConfig =
    tab === "revenue" ? revenueConfig : tab === "spends" ? spendConfig : cpaConfig;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Opens the day drill-down. Rewrites only `day`, carrying every other param
   * through — the range and split-window keys must survive the click. push, not
   * replace, so Back closes the sheet the way a drill-down should.
   */
  function openDay(day: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", day);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  /**
   * Recharts hands the click a MouseHandlerDataParam whose activeLabel is
   * derived from tooltip state, so it is undefined when the click lands with no
   * active tooltip (a legend click bubbles to the chart root; so does a first
   * tap on touch with no prior hover). Without the fallback and the guard this
   * navigates to ?day=undefined.
   */
  function handleChartClick(state: {
    // activeTooltipIndex is `number | TooltipIndex` in recharts 3.x, and
    // TooltipIndex is a string — hence the coercion rather than a typeof check.
    activeLabel?: string | number;
    activeTooltipIndex?: number | string | null;
  }) {
    let day = state.activeLabel != null ? String(state.activeLabel) : undefined;
    if (day == null && state.activeTooltipIndex != null) {
      const i = Number(state.activeTooltipIndex);
      if (Number.isInteger(i)) day = data[i]?.day;
    }
    if (day != null) openDay(day);
  }

  const drillable = tab === "revenue";

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base font-semibold text-white">
            {COPY[tab].title}
          </CardTitle>
          <CardDescription className="text-sm text-slate-400">
            {COPY[tab].description}
            {l2WindowLabel != null &&
              tab === "revenue" &&
              ` · L2 limited to ${l2WindowLabel}`}
          </CardDescription>
        </div>
        <div
          role="tablist"
          aria-label="Chart metric"
          className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5 text-xs font-medium"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                tab === t.id
                  ? "bg-accent text-accent-foreground"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className={cn("h-64 w-full", drillable && "cursor-pointer")}
        >
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={drillable ? handleChartClick : undefined}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tickMargin={8}
              tickFormatter={formatDay}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value: number) => formatINRCompact(value)}
            />
            <ChartTooltip
              // Drillable tabs paint the click target (see DayColumnCursor);
              // the others keep Recharts' plain hairline, because there is
              // nothing to click and a band would promise otherwise.
              cursor={
                drillable ? <DayColumnCursor count={data.length} /> : true
              }
              content={
                <ChartTooltipContent
                  labelFormatter={formatDay}
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-slate-400">
                        {config[name as string]?.label ?? name}
                      </span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(Number(value))}
                      </span>
                    </div>
                  )}
                  // A tooltip describes; it must never invite an action.
                  // Recharts sets pointerEvents:'none' on the tooltip wrapper
                  // and positions it from the active point, so anything that
                  // reads as a link here promises a target the user cannot
                  // reach — and the attempt to reach it re-triggers hover on
                  // the days in between, silently changing which day a click
                  // would open. Hence muted, no arrow, and wording that names
                  // the column they are already hovering. The real affordances
                  // are the indigo cursor and cursor-pointer, which describe
                  // the target in place.
                  footer={
                    drillable ? (
                      <span className="text-[11px] text-slate-500">
                        Click anywhere on this day
                      </span>
                    ) : undefined
                  }
                />
              }
            />
            {tab === "revenue" && (
              <>
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  type="monotone"
                  dataKey="l2_revenue_paise"
                  stroke="var(--color-l2_revenue_paise)"
                  strokeWidth={2}
                  dot={false}
                  // The whole vertical strip is clickable, so the active dot is
                  // the only thing telling you which day you are about to open.
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="l1_revenue_paise"
                  stroke="var(--color-l1_revenue_paise)"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </>
            )}
            {tab === "spends" && (
              <Line
                type="monotone"
                dataKey="spend_paise"
                stroke="var(--color-spend_paise)"
                strokeWidth={2}
                dot={false}
              />
            )}
            {tab === "cpa" && (
              <Line
                type="monotone"
                dataKey="cpa_paise"
                stroke="var(--color-cpa_paise)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}
          </LineChart>
        </ChartContainer>

        {/*
          The keyboard path to the drill-down. Recharts' accessibilityLayer
          makes the SVG focusable and arrow keys move the active point, but
          Enter on a focused <svg> dispatches no click and Recharts exposes no
          keydown passthrough — so the chart alone leaves keyboard users with no
          way in. A native select is one tab stop with real listbox semantics
          and no ARIA to get wrong, and it doubles as visible discoverability
          for anyone who would never think to click a chart.
        */}
        {drillable && data.length > 0 && (
          <div className="mt-3 flex justify-end">
            <label className="flex items-center gap-2">
              <span className="sr-only">Open the payments for a day</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value !== "") openDay(e.target.value);
                }}
                className="h-9 cursor-pointer rounded-lg border border-border bg-white/5 px-3 text-xs text-slate-400 transition-colors hover:text-white focus:outline-none"
              >
                <option value="">Open a day…</option>
                {data.map((row) => (
                  <option key={row.day} value={row.day}>
                    {formatDayShort(row.day)} — L1{" "}
                    {formatINR(row.l1_revenue_paise)} · L2{" "}
                    {formatINR(row.l2_revenue_paise)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

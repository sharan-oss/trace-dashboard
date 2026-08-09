"use client";

import { Lock } from "lucide-react";
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
import { formatINR, formatINRCompact } from "@/lib/format";
import type { RevenueDailyRow } from "@/lib/queries/overview";

/**
 * The Overview chart card. Three tabs by design — Spends | Revenue | CPA —
 * but Spends and CPA are Meta-derived and stay locked placeholders until
 * the Meta account connects, so Revenue is the only live panel and there is
 * deliberately no tab state yet. No fake zero-lines for locked tabs.
 *
 * Series palette (decided 2026-08-10, design system v2): L2 is the hero
 * line in indigo (chart-1) at 2px — it is the 1.6x acquisition story — and
 * L1 is the slate baseline (chart-2) at 1.5px. Two series max.
 */

const chartConfig = {
  l2_revenue_paise: { label: "L2 revenue", color: "var(--chart-1)" },
  l1_revenue_paise: { label: "L1 revenue", color: "var(--chart-2)" },
} satisfies ChartConfig;

const dayTick = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatDay(day: unknown): string {
  const t = Date.parse(`${String(day)}T00:00:00Z`);
  return Number.isNaN(t) ? String(day) : dayTick.format(t);
}

function LockedTab({ label }: { label: string }) {
  return (
    <span
      title="Connect Meta to unlock"
      className="flex cursor-not-allowed items-center gap-1 rounded-md px-2.5 py-1 text-slate-600 select-none"
    >
      <Lock size={11} aria-hidden="true" />
      {label}
    </span>
  );
}

export function RevenueChartCard({ data }: { data: RevenueDailyRow[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base font-semibold text-white">
            Revenue
          </CardTitle>
          <CardDescription className="text-sm text-slate-400">
            Daily L1 and L2 revenue · Spends &amp; CPA unlock when Meta
            connects
          </CardDescription>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5 text-xs font-medium">
          <LockedTab label="Spends" />
          <span className="rounded-md bg-accent px-2.5 py-1 text-accent-foreground">
            L1 + L2 Revenue
          </span>
          <LockedTab label="CPA" />
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
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
              content={
                <ChartTooltipContent
                  labelFormatter={formatDay}
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-slate-400">
                        {chartConfig[name as keyof typeof chartConfig]?.label ??
                          name}
                      </span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="l2_revenue_paise"
              stroke="var(--color-l2_revenue_paise)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="l1_revenue_paise"
              stroke="var(--color-l1_revenue_paise)"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

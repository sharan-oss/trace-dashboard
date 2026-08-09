"use client";

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
 * but Spends and CPA are Meta-derived and stay disabled placeholders until
 * the Meta account connects, so Revenue is the only live panel and there is
 * deliberately no tab state yet. No fake zero-lines for locked tabs.
 *
 * Two series max, greyscale tones only (L1 near-black 2px, L2 mid-grey
 * 1.5px) — the categorical chart palette decision stays deferred.
 */

const chartConfig = {
  l1_revenue_paise: { label: "L1 revenue", color: "var(--chart-5)" },
  l2_revenue_paise: { label: "L2 revenue", color: "var(--chart-2)" },
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
      className="cursor-not-allowed rounded-[5px] px-2.5 py-1 text-muted-foreground/50 select-none"
    >
      {label}
    </span>
  );
}

export function RevenueChartCard({ data }: { data: RevenueDailyRow[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-base">Revenue</CardTitle>
          <CardDescription>
            Daily L1 and L2 revenue · Spends &amp; CPA unlock when Meta
            connects
          </CardDescription>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5 text-xs font-medium">
          <LockedTab label="Spends" />
          <span className="rounded-[5px] bg-accent px-2.5 py-1 text-accent-foreground">
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
                  formatter={(value, name, item) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ??
                          name}
                      </span>
                      <span className="font-mono tabular-nums">
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
              dataKey="l1_revenue_paise"
              stroke="var(--color-l1_revenue_paise)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="l2_revenue_paise"
              stroke="var(--color-l2_revenue_paise)"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

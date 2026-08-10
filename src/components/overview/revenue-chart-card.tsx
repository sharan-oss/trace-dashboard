"use client";

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
import { formatINR, formatINRCompact } from "@/lib/format";
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
    description: "Daily L1 and L2 revenue",
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

export function RevenueChartCard({ data }: { data: OverviewChartRow[] }) {
  const [tab, setTab] = useState<Tab>("revenue");
  const config: ChartConfig =
    tab === "revenue" ? revenueConfig : tab === "spends" ? spendConfig : cpaConfig;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base font-semibold text-white">
            {COPY[tab].title}
          </CardTitle>
          <CardDescription className="text-sm text-slate-400">
            {COPY[tab].description}
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
        <ChartContainer config={config} className="h-64 w-full">
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
                        {config[name as string]?.label ?? name}
                      </span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(Number(value))}
                      </span>
                    </div>
                  )}
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
                />
                <Line
                  type="monotone"
                  dataKey="l1_revenue_paise"
                  stroke="var(--color-l1_revenue_paise)"
                  strokeWidth={1.5}
                  dot={false}
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
      </CardContent>
    </Card>
  );
}

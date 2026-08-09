import { cookies } from "next/headers";
import {
  IndianRupee,
  MousePointerClick,
  TrendingUp,
  Users,
} from "lucide-react";
import { BentoGrid } from "@/components/ui/bento-grid";
import { DateRangePicker } from "@/components/date-range-picker";
import { KpiTile } from "@/components/overview/kpi-tile";
import { RevenueChartCard } from "@/components/overview/revenue-chart-card";
import { TopAdsTable } from "@/components/overview/top-ads-table";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { formatCount, formatINR, formatPercent } from "@/lib/format";
import {
  CONVERSION_RATE_LABEL,
  conversionRate,
} from "@/lib/metrics/definitions";
import {
  fillDailyGaps,
  getClients,
  getOverviewKpis,
  getRevenueDaily,
  getTopAds,
  istToday,
  rangeStartDay,
} from "@/lib/queries/overview";
import { parseRangeParam } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { range } = await searchParams;
  const preset = parseRangeParam(range);

  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const cookieStore = await cookies();
  const selected = resolveSelectedClient(
    clients,
    cookieStore.get(CLIENT_COOKIE)?.value,
  );

  if (selected == null) {
    return (
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <Users size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">
            No clients are visible to this identity. Check the dev identity
            env (DEV_ROLE / DEV_CLIENT_ID).
          </p>
        </div>
      </div>
    );
  }

  const [kpis, daily, ads] = await Promise.all([
    getOverviewKpis(supabase, selected.id, preset),
    getRevenueDaily(supabase, selected.id, preset),
    getTopAds(supabase, selected.id, preset),
  ]);

  const today = istToday();
  const fromDay = rangeStartDay(preset, today) ?? daily[0]?.day ?? today;
  const chartData = fillDailyGaps(daily, fromDay, today);

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="mt-0.5 text-sm text-slate-400">{selected.name}</p>
        </div>
        <DateRangePicker value={preset} />
      </header>

      <BentoGrid className="auto-rows-[minmax(120px,auto)]">
        <KpiTile
          label="Total spend"
          value="—"
          caption="Connect Meta to unlock"
          locked
        />
        <KpiTile
          label="L1 revenue"
          value={formatINR(kpis.l1_revenue_paise)}
          valueSuffix={`(${formatCount(kpis.l1_paid_count)})`}
          caption="Paid front-end transactions"
          icon={IndianRupee}
          hero
        />
        <KpiTile
          label="L2 revenue"
          value={formatINR(kpis.l2_revenue_paise)}
          valueSuffix={`(${formatCount(kpis.l2_count)})`}
          caption="Partial import — backfill pending"
          icon={TrendingUp}
          hero
        />
        <KpiTile
          label="CPA"
          value="—"
          caption="Connect Meta to unlock"
          locked
        />
        <KpiTile
          label="Sessions"
          value={formatCount(kpis.sessions_count)}
          icon={Users}
        />
        <KpiTile
          label={CONVERSION_RATE_LABEL}
          value={formatPercent(
            conversionRate(kpis.l1_paid_count, kpis.sessions_count),
          )}
          caption="Sessions → paid"
          icon={MousePointerClick}
        />
      </BentoGrid>

      <RevenueChartCard data={chartData} />

      <TopAdsTable rows={ads} />
    </div>
  );
}

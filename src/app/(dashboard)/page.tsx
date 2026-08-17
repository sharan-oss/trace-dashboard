import { cookies } from "next/headers";
import {
  IndianRupee,
  Megaphone,
  MousePointerClick,
  Percent,
  TrendingUp,
  Users,
} from "lucide-react";
import { BentoGrid } from "@/components/ui/bento-grid";
import { DateRangePicker } from "@/components/date-range-picker";
import { KpiTile } from "@/components/overview/kpi-tile";
import { RevenueChartCard } from "@/components/overview/revenue-chart-card";
import { TopAdsTable } from "@/components/overview/top-ads-table";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import {
  formatCount,
  formatDayRange,
  formatINR,
  formatPercent,
} from "@/lib/format";
import {
  CONVERSION_RATE_LABEL,
  CPA_LABEL,
  META_SPEND_LABEL,
  conversionRate,
  cpa,
} from "@/lib/metrics/definitions";
import { getAdsSummary, getSpendDaily } from "@/lib/queries/ads";
import {
  chartSpan,
  fillDailyGaps,
  getClients,
  getOverviewKpis,
  getRevenueDaily,
  getTopAds,
  hasExternalPayments,
  istToday,
} from "@/lib/queries/overview";
import { parseRangeState, type RangeSearchParams } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<RangeSearchParams>;
}) {
  const state = parseRangeState(await searchParams);

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
            No clients are visible to this account yet. Ask your Alttred Miinds
            contact to assign one.
          </p>
        </div>
      </div>
    );
  }

  const [kpis, daily, ads, adsSummary, spendDaily, hasL2] = await Promise.all([
    getOverviewKpis(supabase, selected.id, state),
    getRevenueDaily(supabase, selected.id, state),
    getTopAds(supabase, selected.id, state),
    getAdsSummary(supabase, selected.id, state),
    getSpendDaily(supabase, selected.id, state),
    hasExternalPayments(supabase, selected.id),
  ]);
  const cpaValue = cpa(adsSummary.spend_paise, kpis.l1_paid_count);

  // In split mode the L2 window is stamped onto every surface that shows L2,
  // so a screenshot always says which window produced the number.
  const l2WindowLabel =
    state.l2 == null ? null : formatDayRange(state.l2.from, state.l2.to);

  const today = istToday();
  const span = chartSpan(state, today);
  const fromDay =
    span.from ?? daily[0]?.day ?? spendDaily[0]?.day ?? span.to;
  const spendByDay = new Map(spendDaily.map((r) => [r.day, r]));
  const chartData = fillDailyGaps(daily, fromDay, span.to).map((r) => {
    const s = spendByDay.get(r.day);
    const spend = s?.spend_paise ?? 0;
    const paid = s?.l1_paid_count ?? 0;
    return {
      ...r,
      spend_paise: spend,
      // Null, not zero, when there are no buyers: a zero CPA reads as "free
      // customers"; the line simply breaks instead.
      cpa_paise: paid > 0 ? Math.round(spend / paid) : null,
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="mt-0.5 text-sm text-slate-400">{selected.name}</p>
        </div>
        <DateRangePicker state={state} showCustom showL2Toggle={hasL2} />
      </header>

      <BentoGrid className="auto-rows-[minmax(120px,auto)]">
        <KpiTile
          label={META_SPEND_LABEL}
          value={formatINR(adsSummary.spend_paise)}
          caption="Reported by Meta — never includes other channels"
          icon={Megaphone}
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
          caption={
            l2WindowLabel == null
              ? "Partial import — backfill pending"
              : `Paid ${l2WindowLabel} · buyers acquired in the main range`
          }
          icon={TrendingUp}
          hero
        />
        <KpiTile
          label={CPA_LABEL}
          value={cpaValue == null ? "n/a" : formatINR(Math.round(cpaValue))}
          caption={
            cpaValue == null
              ? "No L1 buyers in range"
              : "Meta spend per new L1 buyer"
          }
          icon={Percent}
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

      <RevenueChartCard data={chartData} l2WindowLabel={l2WindowLabel} />

      <TopAdsTable rows={ads} l2WindowLabel={l2WindowLabel} />
    </div>
  );
}

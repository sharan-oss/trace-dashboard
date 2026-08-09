import { cookies } from "next/headers";
import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoTile } from "@/components/ui/bento-tile";
import { DateRangePicker } from "@/components/date-range-picker";
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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function KpiTile({
  label,
  value,
  valueSuffix,
  caption,
  locked = false,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
  caption?: string;
  locked?: boolean;
}) {
  return (
    <BentoTile className="flex flex-col justify-between gap-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div>
        <p
          className={cn(
            "font-heading text-3xl font-semibold tracking-tight tabular-nums",
            locked && "text-muted-foreground/40",
          )}
        >
          {value}
          {valueSuffix != null && (
            <span className="ml-1.5 text-base font-normal text-muted-foreground">
              {valueSuffix}
            </span>
          )}
        </p>
        {caption != null && (
          <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
        )}
      </div>
    </BentoTile>
  );
}

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
      <div className="p-8 sm:p-12">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Overview
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No clients are visible to this identity. Check the dev identity env
          (DEV_ROLE / DEV_CLIENT_ID).
        </p>
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
    <div className="flex flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {selected.name}
          </p>
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
        />
        <KpiTile
          label="L2 revenue"
          value={formatINR(kpis.l2_revenue_paise)}
          valueSuffix={`(${formatCount(kpis.l2_count)})`}
          caption="Partial import — backfill pending"
        />
        <KpiTile
          label="CPA"
          value="—"
          caption="Connect Meta to unlock"
          locked
        />
        <KpiTile label="Sessions" value={formatCount(kpis.sessions_count)} />
        <KpiTile
          label={CONVERSION_RATE_LABEL}
          value={formatPercent(
            conversionRate(kpis.l1_paid_count, kpis.sessions_count),
          )}
          caption="Sessions → paid"
        />
      </BentoGrid>

      <RevenueChartCard data={chartData} />

      <TopAdsTable rows={ads} />
    </div>
  );
}

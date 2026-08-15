import { cookies } from "next/headers";
import {
  CalendarClock,
  IndianRupee,
  Repeat,
  Scale,
  Target,
  Users,
} from "lucide-react";
import { AcquisitionTable } from "@/components/customers/acquisition-table";
import { TopCustomersStrip } from "@/components/customers/top-customers-strip";
import { ValueConcentrationBar } from "@/components/customers/value-concentration-bar";
import { DateRangePicker } from "@/components/date-range-picker";
import { KpiTile } from "@/components/overview/kpi-tile";
import { BentoGrid } from "@/components/ui/bento-grid";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import {
  formatCount,
  formatDayShort,
  formatDays,
  formatINR,
  formatPercent,
} from "@/lib/format";
import {
  AVG_LTV_LABEL,
  CAC_LABEL,
  LTV_CAC_LABEL,
  REPEAT_RATE_LABEL,
  avgLtv,
  cac,
  ltvCac,
  repeatRate,
} from "@/lib/metrics/definitions";
import {
  getCustomersByAd,
  getCustomersKpis,
  getCustomersLadder,
  getTopCustomers,
  splitFirstVsRepeat,
} from "@/lib/queries/customers";
import { getClients } from "@/lib/queries/overview";
import { parseRangeParam } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TOP_CUSTOMERS = 8;

/**
 * Customers — the Value tab.
 *
 * /ads answers the media buyer's question, "which ad do I scale?". This page
 * answers the owner's: is the machine profitable, and can I afford to feed it
 * more? The two are not the same question, because the revenue that decides the
 * second one arrives days later on a payment link that never touches Trace's
 * checkout.
 *
 * THE RANGE MEANS AN ACQUISITION COHORT — customers who FIRST paid in the
 * window, valued in full even when their upsell lands after it. That is what
 * makes LTV:CAC honest: both sides describe the same people. Enforced in SQL
 * (migration 20260816090200); see the design doc dated 2026-08-16.
 *
 * ?tab= is parsed but unused for now: the People tab (customer list, purchase
 * timelines) is v2, and a lone tab bar or a greyed-out "coming soon" would make
 * a finished page look unfinished.
 */
export default async function CustomersPage({
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
        <h1 className="text-2xl font-bold text-white">Customers</h1>
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <Users size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">
            No clients are visible to this identity.
          </p>
        </div>
      </div>
    );
  }

  const [kpis, byAd, ladder, top] = await Promise.all([
    getCustomersKpis(supabase, selected.id, preset),
    getCustomersByAd(supabase, selected.id, preset),
    getCustomersLadder(supabase, selected.id, preset),
    getTopCustomers(supabase, selected.id, preset, TOP_CUSTOMERS),
  ]);

  const split = splitFirstVsRepeat(ladder);
  const repeat = repeatRate(kpis.repeat_customers, kpis.cohort_customers);
  const avgLtvValue = avgLtv(kpis.cohort_lifetime_paise, kpis.cohort_customers);
  const cacValue = cac(kpis.spend_paise, kpis.cohort_customers);
  const ltvCacValue = ltvCac(kpis.cohort_lifetime_paise, kpis.spend_paise);

  // The honesty line. LTV:CAC is only as complete as the upsell history behind
  // it, and Love School's import currently covers 10 payments across four weeks
  // — so the ratio is real but understated, and saying so is the difference
  // between a measurement and a verdict.
  const coverage =
    kpis.l2_rows > 0
      ? `Upsell import: ${formatCount(kpis.l2_rows)} ${
          kpis.l2_rows === 1 ? "payment" : "payments"
        }, ${formatDayShort(kpis.l2_first_day)}–${formatDayShort(kpis.l2_last_day)}`
      : "No upsell payments imported — this counts first purchases only";

  // Customers acquired inside the last week have not had their upsell window
  // (median ~3 days) fully close, so their lifetime value is not yet meaningful.
  const immatureShare =
    kpis.cohort_customers > 0
      ? kpis.immature_customers / kpis.cohort_customers
      : 0;
  const ltvCaption =
    kpis.immature_customers > 0
      ? `${formatCount(kpis.immature_customers)} acquired in the last 7 days — still maturing`
      : "Lifetime to date, both checkout and upsells";

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {selected.name} · people who first bought in this range, valued in
            full
          </p>
        </div>
        <DateRangePicker value={preset} />
      </header>

      <BentoGrid className="auto-rows-[minmax(120px,auto)]">
        <KpiTile
          label="New customers"
          value={formatCount(kpis.cohort_customers)}
          caption="First purchase in this range"
          icon={Users}
        />
        <KpiTile
          label={REPEAT_RATE_LABEL}
          value={formatPercent(repeat)}
          valueSuffix={`(${formatCount(kpis.repeat_customers)})`}
          caption="Bought more than once"
          icon={Repeat}
        />
        <KpiTile
          label={AVG_LTV_LABEL}
          value={avgLtvValue == null ? "n/a" : formatINR(Math.round(avgLtvValue))}
          caption={ltvCaption}
          icon={IndianRupee}
          hero
        />
        <KpiTile
          label={LTV_CAC_LABEL}
          value={ltvCacValue == null ? "n/a" : `${ltvCacValue.toFixed(2)}×`}
          caption={ltvCacValue == null ? "No Meta spend in range" : coverage}
          icon={Scale}
          hero
        />
        <KpiTile
          label={CAC_LABEL}
          value={cacValue == null ? "n/a" : formatINR(Math.round(cacValue))}
          caption={
            cacValue == null
              ? "No Meta spend in range"
              : "Meta spend per new customer"
          }
          icon={Target}
        />
        <KpiTile
          label="Days to upsell"
          value={formatDays(kpis.median_days_to_second)}
          caption={
            kpis.median_days_to_second == null
              ? "No repeat purchases in this cohort"
              : "Median, first purchase to second"
          }
          icon={CalendarClock}
        />
      </BentoGrid>

      {immatureShare >= 0.2 && (
        <p className="rounded-xl border border-border bg-white/5 px-4 py-3 text-xs text-slate-400 backdrop-blur-md">
          <span className="font-medium text-slate-300">
            {formatPercent(immatureShare, 0)} of this cohort was acquired in the
            last 7 days.
          </span>{" "}
          Upsells land about {formatDays(kpis.median_days_to_second ?? 3)} after
          the first purchase, so their lifetime value — and every ratio built on
          it — is still filling in.
        </p>
      )}

      <ValueConcentrationBar
        firstPaise={split.firstPaise}
        firstPurchases={split.firstPurchases}
        repeatPaise={split.repeatPaise}
        repeatPurchases={split.repeatPurchases}
        totalPaise={split.totalPaise}
        repeatCustomers={kpis.repeat_customers}
        totalCustomers={kpis.cohort_customers}
      />

      <TopCustomersStrip rows={top} />

      <AcquisitionTable rows={byAd} />
    </div>
  );
}

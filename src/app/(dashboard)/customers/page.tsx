import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CalendarClock,
  IndianRupee,
  Repeat,
  Scale,
  Target,
  Users,
} from "lucide-react";
import { AcquisitionTable } from "@/components/customers/acquisition-table";
import { CustomerSheet } from "@/components/customers/customer-sheet";
import { CustomersTabs, type CustomersTab } from "@/components/customers/customers-tabs";
import { PeopleTable } from "@/components/customers/people-table";
import { TopCustomersStrip } from "@/components/customers/top-customers-strip";
import { ValueConcentrationBar } from "@/components/customers/value-concentration-bar";
import { DateRangePicker } from "@/components/date-range-picker";
import { KpiTile } from "@/components/overview/kpi-tile";
import { BentoGrid } from "@/components/ui/bento-grid";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { getAdCreativeMeta, type AdCreativeMeta } from "@/lib/creatives";
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
  getCustomerDetail,
  getCustomersByAd,
  getCustomersKpis,
  getCustomersLadder,
  getCustomersPage,
  getTopCustomers,
  splitFirstVsRepeat,
  type PeopleSort,
  type SortDir,
} from "@/lib/queries/customers";
import { getClients } from "@/lib/queries/overview";
import { parseRangeParam, presetState } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TOP_CUSTOMERS = 8;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Signed creative meta for the ad keys on screen, as a plain object — this
 * crosses into client components (AdPeek), and a Map does not serialize.
 */
async function creativeMetaFor(
  supabase: SupabaseClient,
  clientId: string,
  adKeys: (string | null)[],
): Promise<Record<string, AdCreativeMeta>> {
  const keys = adKeys.filter((k): k is string => k != null);
  const map = await getAdCreativeMeta(supabase, clientId, keys);
  return Object.fromEntries(map);
}

/**
 * Customers — Value | People.
 *
 * /ads answers the media buyer's question, "which ad do I scale?". This
 * section answers the owner's: is the machine profitable, and can I afford to
 * feed it more? Value is the economics argument; People is the individuals
 * behind it, with the receipts one click deep (?customer=).
 *
 * THE RANGE MEANS AN ACQUISITION COHORT on both tabs — customers who FIRST
 * paid in the window, valued in full even when their upsell lands after it.
 * That is what makes LTV:CAC honest, and it is why the two tabs can never
 * disagree about who is included (asserted by test). Enforced in SQL for the
 * Value RPCs (migration 20260816090200) and by rangeStartDay() for the People
 * page read — the same day arithmetic on both sides.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    tab?: string | string[];
    q?: string | string[];
    sort?: string | string[];
    dir?: string | string[];
    repeat?: string | string[];
    page?: string | string[];
    customer?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const preset = parseRangeParam(params.range);
  const tab: CustomersTab = first(params.tab) === "people" ? "people" : "value";

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

  // The People branch returns early: it shares the header/tabs shell but none
  // of the Value tab's aggregates, so fetching them would be waste.
  if (tab === "people") {
    const sortParam = first(params.sort);
    const sort: PeopleSort =
      sortParam === "newest" || sortParam === "fastest" ? sortParam : "ltv";
    const dirParam = first(params.dir);
    const dir: SortDir = dirParam === "asc" || dirParam === "desc"
      ? dirParam
      : sort === "fastest"
        ? "asc"
        : "desc";
    const search = first(params.q) ?? "";
    const repeatOnly = first(params.repeat) === "1";
    const pageNum = Math.max(0, Number.parseInt(first(params.page) ?? "0", 10) || 0);
    const customerId = first(params.customer) || null;

    const [{ rows, total }, detail] = await Promise.all([
      getCustomersPage(supabase, selected.id, preset, {
        search,
        sort,
        dir,
        repeatOnly,
        page: pageNum,
      }),
      customerId != null
        ? getCustomerDetail(supabase, customerId)
        : Promise.resolve(null),
    ]);

    const creativeMeta = await creativeMetaFor(supabase, selected.id, [
      ...rows.map((r) => r.ad_key),
      detail?.customer.ad_key ?? null,
    ]);

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
          <DateRangePicker state={presetState(preset)} />
        </header>

        <CustomersTabs active="people" range={preset} />

        <PeopleTable
          rows={rows}
          total={total}
          page={pageNum}
          search={search}
          sort={sort}
          dir={dir}
          repeatOnly={repeatOnly}
          creativeMeta={creativeMeta}
        />

        {detail != null && (
          <CustomerSheet detail={detail} creativeMeta={creativeMeta} />
        )}
      </div>
    );
  }

  const [kpis, byAd, ladder, top] = await Promise.all([
    getCustomersKpis(supabase, selected.id, preset),
    getCustomersByAd(supabase, selected.id, preset),
    getCustomersLadder(supabase, selected.id, preset),
    getTopCustomers(supabase, selected.id, preset, TOP_CUSTOMERS),
  ]);

  const creativeMeta = await creativeMetaFor(supabase, selected.id, [
    ...top.map((r) => r.ad_key),
    ...byAd.map((r) => r.ad_key),
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
        <DateRangePicker state={presetState(preset)} />
      </header>

      <CustomersTabs active="value" range={preset} />

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

      <TopCustomersStrip rows={top} creativeMeta={creativeMeta} />

      <AcquisitionTable rows={byAd} creativeMeta={creativeMeta} />
    </div>
  );
}

import { cookies } from "next/headers";
import {
  IndianRupee,
  Megaphone,
  MousePointerClick,
  Percent,
  Target,
  TrendingUp,
} from "lucide-react";
import { AdsDrilldownTable } from "@/components/ads/ads-drilldown-table";
import { SyncStatusNote } from "@/components/ads/sync-status-note";
import { DateRangePicker } from "@/components/date-range-picker";
import { KpiTile } from "@/components/overview/kpi-tile";
import { BentoGrid } from "@/components/ui/bento-grid";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { formatCount, formatINR, formatPercent } from "@/lib/format";
import {
  CONVERSION_RATE_LABEL,
  CPA_LABEL,
  META_SPEND_LABEL,
  ROAS_LABEL,
  conversionRate,
  cpa,
  roas,
} from "@/lib/metrics/definitions";
import {
  getAdAccountsSyncStatus,
  getAdThumbnails,
  getAdsBreakdown,
  getAdsSummary,
} from "@/lib/queries/ads";
import { getClients, getOverviewKpis } from "@/lib/queries/overview";
import { parseRangeParam } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CREATIVES_BUCKET = "ad-creatives";
const SIGNED_URL_TTL_S = 3600;

export default async function AdsPage({
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
        <h1 className="text-2xl font-bold text-white">Ads</h1>
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <Megaphone size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">
            No clients are visible to this identity.
          </p>
        </div>
      </div>
    );
  }

  const accounts = await getAdAccountsSyncStatus(supabase, selected.id);

  // Empty state: no Meta ad account mapped for this client. Mapping is an
  // admin action via the sync API for now; self-serve Connect arrives after
  // Phase 2 login.
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Ads</h1>
            <p className="mt-0.5 text-sm text-slate-400">{selected.name}</p>
          </div>
        </header>
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <Megaphone size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">
            No Meta ad account is connected for {selected.name} yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">
            Accounts are mapped by the admin through the sync API. A
            self-serve Connect flow ships with client login (Phase 2).
          </p>
        </div>
      </div>
    );
  }

  const [summary, breakdown, kpis] = await Promise.all([
    getAdsSummary(supabase, selected.id, preset),
    getAdsBreakdown(supabase, selected.id, preset),
    getOverviewKpis(supabase, selected.id, preset),
  ]);

  // Signed thumbnail URLs for the ad rows — minted server-side from the
  // private bucket, so tenant scoping travels with the URL's expiry.
  const adKeys = breakdown
    .filter((r) => r.tier === "ad" && r.ad_key != null)
    .map((r) => r.ad_key as string);
  const thumbs = await getAdThumbnails(supabase, selected.id, adKeys);
  const paths = [...thumbs.values()]
    .map((t) => t.creative_thumbnail_path)
    .filter((p): p is string => p != null);
  const thumbnailUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(CREATIVES_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_S);
    const byPath = new Map(
      (signed ?? [])
        .filter((s) => s.signedUrl != null && s.error == null)
        .map((s) => [s.path, s.signedUrl]),
    );
    for (const [metaAdId, t] of thumbs) {
      const url =
        t.creative_thumbnail_path != null
          ? byPath.get(t.creative_thumbnail_path)
          : undefined;
      if (url != null) thumbnailUrls[metaAdId] = url;
    }
  }

  const totalRevenue = kpis.l1_revenue_paise + kpis.l2_revenue_paise;
  const roasValue = roas(totalRevenue, summary.spend_paise);
  const cpaValue = cpa(summary.spend_paise, kpis.l1_paid_count);
  const conv = conversionRate(kpis.l1_paid_count, kpis.sessions_count);

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Ads</h1>
          <p className="mt-0.5 text-sm text-slate-400">{selected.name}</p>
        </div>
        <DateRangePicker value={preset} />
      </header>

      <SyncStatusNote accounts={accounts} />

      <BentoGrid className="auto-rows-[minmax(120px,auto)]">
        <KpiTile
          label={META_SPEND_LABEL}
          value={formatINR(summary.spend_paise)}
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
          caption="Credited to the acquiring ad"
          icon={TrendingUp}
          hero
        />
        <KpiTile
          label={ROAS_LABEL}
          value={roasValue == null ? "n/a" : `${roasValue.toFixed(2)}×`}
          caption={
            roasValue == null
              ? "No Meta spend in range"
              : "Full customer value ÷ Meta spend"
          }
          icon={Target}
        />
        <KpiTile
          label={CPA_LABEL}
          value={cpaValue == null ? "n/a" : formatINR(Math.round(cpaValue))}
          caption={
            cpaValue == null ? "No L1 buyers in range" : "Meta spend per new L1 buyer"
          }
          icon={Percent}
        />
        <KpiTile
          label={CONVERSION_RATE_LABEL}
          value={formatPercent(conv)}
          caption="Sessions → paid"
          icon={MousePointerClick}
        />
      </BentoGrid>

      <AdsDrilldownTable
        rows={breakdown}
        thumbnailUrls={thumbnailUrls}
        spendUntrackedPaise={summary.spend_untracked_paise}
        unattributedL1RevenuePaise={summary.unattributed_l1_revenue_paise}
        unattributedL1Count={summary.unattributed_l1_count}
      />
    </div>
  );
}

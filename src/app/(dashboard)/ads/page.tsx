import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IndianRupee,
  Megaphone,
  MousePointerClick,
  Percent,
  Target,
  TrendingUp,
} from "lucide-react";
import { AdCards } from "@/components/ads/ad-cards";
import type { AdCardData } from "@/components/ads/ad-card";
import { AdsTabs, type AdsTab } from "@/components/ads/ads-tabs";
import { CampaignsTable } from "@/components/ads/campaigns-table";
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
  getAdsBreakdown,
  getAdsDimension,
  getAdsSummary,
  type AdsBreakdownRow,
  type AdDimensionRow,
} from "@/lib/queries/ads";
import { getClients, getOverviewKpis } from "@/lib/queries/overview";
import { parseRangeParam } from "@/lib/range";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CREATIVES_BUCKET = "ad-creatives";
const SIGNED_URL_TTL_S = 3600;
const SIGN_CHUNK = 200;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Signed URLs for every dimension thumbnail, chunked under API limits. */
async function signThumbnails(
  supabase: SupabaseClient,
  dimension: AdDimensionRow[],
): Promise<Map<string, string>> {
  const withPath = dimension.filter((d) => d.creative_thumbnail_path != null);
  const out = new Map<string, string>();
  for (let i = 0; i < withPath.length; i += SIGN_CHUNK) {
    const chunk = withPath.slice(i, i + SIGN_CHUNK);
    const { data: signed } = await supabase.storage
      .from(CREATIVES_BUCKET)
      .createSignedUrls(
        chunk.map((d) => d.creative_thumbnail_path as string),
        SIGNED_URL_TTL_S,
      );
    const byPath = new Map(
      (signed ?? [])
        .filter((s) => s.signedUrl != null && s.error == null)
        .map((s) => [s.path, s.signedUrl]),
    );
    for (const d of chunk) {
      const url = byPath.get(d.creative_thumbnail_path as string);
      if (url != null) out.set(d.meta_ad_id, url);
    }
  }
  return out;
}

/**
 * One card per ad: the dimension provides identity (every ad, including
 * paused/zero-activity ones), the breakdown provides in-range numbers. A
 * breakdown ad the dimension somehow lacks still gets a card — data is never
 * silently dropped.
 */
function mergeCards(
  dimension: AdDimensionRow[],
  breakdown: AdsBreakdownRow[],
  thumbnails: Map<string, string>,
): AdCardData[] {
  const adRows = breakdown.filter((r) => r.tier === "ad" && r.ad_key != null);
  const byKey = new Map(adRows.map((r) => [r.ad_key as string, r]));
  const cards: AdCardData[] = dimension.map((d) => {
    const b = byKey.get(d.meta_ad_id);
    return {
      adKey: d.meta_ad_id,
      adName: d.ad_name ?? b?.ad_name ?? null,
      adsetKey: d.meta_adset_id ?? b?.adset_key ?? null,
      adsetName: d.adset_name ?? b?.adset_name ?? null,
      campaignKey: d.meta_campaign_id ?? b?.campaign_key ?? null,
      campaignName: d.campaign_name ?? b?.campaign_name ?? null,
      status: d.status,
      thumbnailUrl: thumbnails.get(d.meta_ad_id) ?? null,
      spendPaise: b?.spend_paise ?? 0,
      impressions: b?.impressions ?? 0,
      clicks: b?.clicks ?? 0,
      l1RevenuePaise: b?.l1_revenue_paise ?? 0,
      l1PaidCount: b?.l1_paid_count ?? 0,
      l2RevenuePaise: b?.l2_revenue_paise ?? 0,
      l2Count: b?.l2_count ?? 0,
      nameMatched: b?.name_matched ?? false,
      hasTest: b?.has_test ?? false,
      hasActivity: b != null,
    };
  });
  const dimKeys = new Set(dimension.map((d) => d.meta_ad_id));
  for (const b of adRows) {
    if (dimKeys.has(b.ad_key as string)) continue;
    cards.push({
      adKey: b.ad_key as string,
      adName: b.ad_name,
      adsetKey: b.adset_key,
      adsetName: b.adset_name,
      campaignKey: b.campaign_key,
      campaignName: b.campaign_name,
      status: "unknown",
      thumbnailUrl: null,
      spendPaise: b.spend_paise,
      impressions: b.impressions,
      clicks: b.clicks,
      l1RevenuePaise: b.l1_revenue_paise,
      l1PaidCount: b.l1_paid_count,
      l2RevenuePaise: b.l2_revenue_paise,
      l2Count: b.l2_count,
      nameMatched: b.name_matched,
      hasTest: b.has_test,
      hasActivity: true,
    });
  }
  return cards;
}

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    tab?: string | string[];
    campaign?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const preset = parseRangeParam(params.range);
  const tab: AdsTab = first(params.tab) === "ads" ? "ads" : "campaigns";
  const campaignParam = first(params.campaign) || null;

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

  const [summary, breakdown] = await Promise.all([
    getAdsSummary(supabase, selected.id, preset),
    getAdsBreakdown(supabase, selected.id, preset),
  ]);

  let view: React.ReactNode;
  if (tab === "campaigns") {
    const kpis = await getOverviewKpis(supabase, selected.id, preset);
    const totalRevenue = kpis.l1_revenue_paise + kpis.l2_revenue_paise;
    const roasValue = roas(totalRevenue, summary.spend_paise);
    const cpaValue = cpa(summary.spend_paise, kpis.l1_paid_count);
    const conv = conversionRate(kpis.l1_paid_count, kpis.sessions_count);
    view = (
      <>
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
        <CampaignsTable
          rows={breakdown}
          range={preset}
          spendUntrackedPaise={summary.spend_untracked_paise}
          unattributedL1RevenuePaise={summary.unattributed_l1_revenue_paise}
          unattributedL1Count={summary.unattributed_l1_count}
        />
      </>
    );
  } else {
    const dimension = await getAdsDimension(supabase, selected.id);
    const thumbnails = await signThumbnails(supabase, dimension);
    const cards = mergeCards(dimension, breakdown, thumbnails);
    const campaignNames = new Map<string, string>();
    for (const c of cards) {
      if (c.campaignKey != null && !campaignNames.has(c.campaignKey)) {
        campaignNames.set(c.campaignKey, c.campaignName ?? c.campaignKey);
      }
    }
    // Unattributed rows never appear as cards: their revenue has no ad to
    // claim it, so the banner inside AdCards carries it instead. L2's share
    // comes off the ad-tier null-key bucket — the exact complement of the
    // rows carded above, so strip + banner always total the L2 KPI.
    const unattributedL2 = breakdown
      .filter((r) => r.tier === "ad" && r.ad_key == null)
      .reduce(
        (t, r) => ({ paise: t.paise + r.l2_revenue_paise, count: t.count + r.l2_count }),
        { paise: 0, count: 0 },
      );
    const campaigns = [...campaignNames.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    view = (
      <AdCards
        ads={cards}
        campaigns={campaigns}
        activeCampaign={campaignParam}
        spendUntrackedPaise={summary.spend_untracked_paise}
        unattributedL1RevenuePaise={summary.unattributed_l1_revenue_paise}
        unattributedL1Count={summary.unattributed_l1_count}
        unattributedL2RevenuePaise={unattributedL2.paise}
        unattributedL2Count={unattributedL2.count}
      />
    );
  }

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

      <AdsTabs active={tab} range={preset} />

      {view}
    </div>
  );
}

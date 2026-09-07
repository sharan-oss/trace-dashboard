import { ExternalLink, ImageOff } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCount, formatINR, formatPercent } from "@/lib/format";
import { adsManagerUrl } from "@/lib/meta/ads-manager";
import { cpa, cpm, ctr, roas } from "@/lib/metrics/definitions";

/**
 * One Meta ad as a creative card: thumbnail, identity (name, ad-set chip,
 * status), and the decision metrics. Spend + ROAS lead; L1/L2/CPA carry the
 * money detail; CTR/CPM are Meta-native delivery health. Ratio values render
 * "n/a" on a zero denominator — never a zero that reads as data.
 */

export type AdCardData = {
  adKey: string;
  adName: string | null;
  adsetKey: string | null;
  adsetName: string | null;
  campaignKey: string | null;
  campaignName: string | null;
  /** Meta effective_status, lowercased ("active", "paused", "campaign_paused", …). */
  status: string;
  thumbnailUrl: string | null;
  spendPaise: number;
  impressions: number;
  clicks: number;
  l1RevenuePaise: number;
  l1PaidCount: number;
  l2RevenuePaise: number;
  l2Count: number;
  nameMatched: boolean;
  hasTest: boolean;
  /** Appeared in the breakdown for this range (spend, revenue or sessions). */
  hasActivity: boolean;
  /**
   * ad_accounts.id owning this ad, resolved to an `act_…` by the caller. Null
   * on breakdown-only cards, which have no dimension row to read it from.
   */
  adAccountId: string | null;
};

/** Collapse Meta's status zoo into the three states a buyer acts on. */
export function statusGroup(status: string): "active" | "paused" | "inactive" {
  if (status === "active") return "active";
  if (status.endsWith("paused")) return "paused";
  return "inactive";
}

function NotApplicable() {
  return (
    <span className="text-slate-600" title="Not applicable — no data to compute this from">
      n/a
    </span>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-xs text-slate-300 tabular-nums">{children}</div>
    </div>
  );
}

export function AdCard({
  ad,
  metaAdAccountFor,
}: {
  ad: AdCardData;
  /**
   * Resolves this ad's own account uuid to its `act_…` id. Per-ad, not a single
   * account for the page: a client can have several, and a link naming the
   * wrong one fails silently. Returning null just hides the link, which is the
   * right answer when ownership is unknown.
   */
  metaAdAccountFor?: (adAccountId: string | null) => string | null;
}) {
  const totalRevenue = ad.l1RevenuePaise + ad.l2RevenuePaise;
  const roasValue = roas(totalRevenue, ad.spendPaise);
  const cpaValue = cpa(ad.spendPaise, ad.l1PaidCount);
  const ctrValue = ctr(ad.clicks, ad.impressions);
  const cpmValue = cpm(ad.spendPaise, ad.impressions);
  const group = statusGroup(ad.status);
  const name = ad.adName ?? ad.adKey;
  const metaUrl = adsManagerUrl(
    metaAdAccountFor?.(ad.adAccountId) ?? null,
    ad.adKey,
    ad.campaignKey,
  );

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card backdrop-blur-md transition-colors hover:border-white/20">
      {metaUrl != null && (
        // The escape hatch for what a still frame cannot show — full video,
        // carousel frames, the live creative. Meta resolves the id at click
        // time, so it never goes stale, and it costs no API call.
        <a
          href={metaUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this ad in Meta Ads Manager"
          className="absolute top-2 right-2 z-10 rounded-md border border-white/10 bg-slate-950/70 p-1.5 text-slate-300 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-white"
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span className="sr-only">Open {name} in Meta Ads Manager</span>
        </a>
      )}
      {ad.thumbnailUrl != null ? (
        // Signed URL from the private bucket — plain img, remote next/image is
        // pointless for a 1h-expiring URL. Mirrored at 720x720 since the
        // 2026-08-13 refresh; width/height reserve the box against CLS.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          width={720}
          height={720}
          className="aspect-square w-full border-b border-white/5 object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center border-b border-white/5 bg-white/3 text-slate-600">
          <ImageOff size={24} aria-hidden="true" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3
              className="line-clamp-2 text-sm font-medium text-white"
              title={name}
            >
              {name}
            </h3>
            {group === "active" && <StatusBadge status="success" label="Active" />}
            {group === "paused" && <StatusBadge status="warning" label="Paused" />}
            {group === "inactive" && (
              <span className="inline-flex items-center text-xs font-medium text-slate-500">
                Inactive
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {ad.adsetName != null && (
              <span
                className="max-w-40 truncate rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                title={`Ad set: ${ad.adsetName}`}
              >
                {ad.adsetName}
              </span>
            )}
            {ad.nameMatched && (
              <span
                title="Attributed by ad name, not ad id — names are not unique, so treat as approximate"
                className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
              >
                ≈ name
              </span>
            )}
            {ad.hasTest && <StatusBadge status="warning" label="Test" />}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
            <div>
              <div className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                Meta spend
              </div>
              <div className="mt-0.5 text-base font-semibold text-white tabular-nums">
                {formatINR(ad.spendPaise)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                ROAS (L1+L2)
              </div>
              <div className="mt-0.5 text-base font-semibold text-white tabular-nums">
                {roasValue == null ? <NotApplicable /> : `${roasValue.toFixed(2)}×`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            <Metric label="L1 rev">
              {formatINR(ad.l1RevenuePaise)}
              <span className="ml-1 text-slate-500">({formatCount(ad.l1PaidCount)})</span>
            </Metric>
            <Metric label="L2 rev">
              {formatINR(ad.l2RevenuePaise)}
              <span className="ml-1 text-slate-500">({formatCount(ad.l2Count)})</span>
            </Metric>
            <Metric label="CPA (L1)">
              {cpaValue == null ? <NotApplicable /> : formatINR(Math.round(cpaValue))}
            </Metric>
            <Metric label="CTR">
              {ctrValue == null ? <NotApplicable /> : formatPercent(ctrValue, 2)}
            </Metric>
            <Metric label="CPM">
              {cpmValue == null ? <NotApplicable /> : formatINR(Math.round(cpmValue))}
            </Metric>
          </div>
        </div>
      </div>
    </div>
  );
}

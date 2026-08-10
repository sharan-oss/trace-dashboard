"use client";

import { useState } from "react";
import { ChevronRight, ImageOff } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCount, formatINR, formatPercent } from "@/lib/format";
import { UNATTRIBUTED_LABEL } from "@/lib/metrics/attribution";
import { conversionRate, cpa, roas } from "@/lib/metrics/definitions";
import type { AdsBreakdownRow } from "@/lib/queries/ads";
import { cn } from "@/lib/utils";

/**
 * The campaign → ad set → ad drill-down: ONE table, three zoom levels, expand
 * state only (no routing). Null keys render as the per-level Unattributed
 * bucket — shown, never dropped. Ratio cells render "n/a" when their
 * denominator is zero — never a zero or a dash that reads as zero, because
 * "this ad failed" and "this ad was not tracked" imply opposite actions.
 * ROAS carries no good/bad colour: colour is reserved for semantic status.
 *
 * The two reconciliation rows are always present, even at zero, so their
 * absence never reads as "there is no gap": spend the tracker never saw a
 * session for, and paid revenue no ad can claim. With them, the spend column
 * totals real spend and the revenue columns total real revenue.
 */

type Props = {
  rows: AdsBreakdownRow[];
  /** meta_ad_id → 1h signed thumbnail URL (minted server-side, private bucket). */
  thumbnailUrls: Record<string, string>;
  spendUntrackedPaise: number;
  unattributedL1RevenuePaise: number;
  unattributedL1Count: number;
};

function keyOf(row: AdsBreakdownRow): string {
  return `${row.tier}:${row.campaign_key ?? "∅"}:${row.adset_key ?? "∅"}:${row.ad_key ?? "∅"}`;
}

function NotApplicable() {
  return (
    <span className="text-slate-600" title="Not applicable — no data to compute this from">
      n/a
    </span>
  );
}

function RatioCells({ row }: { row: AdsBreakdownRow }) {
  const totalRevenue = row.l1_revenue_paise + row.l2_revenue_paise;
  const roasValue = roas(totalRevenue, row.spend_paise);
  const cpaValue = cpa(row.spend_paise, row.l1_paid_count);
  const conv = conversionRate(row.l1_paid_count, row.sessions_count);
  return (
    <>
      <td className="py-2.5 pr-4 text-right tabular-nums">
        {roasValue == null ? <NotApplicable /> : `${roasValue.toFixed(2)}×`}
      </td>
      <td className="py-2.5 pr-4 text-right tabular-nums">
        {cpaValue == null ? <NotApplicable /> : formatINR(Math.round(cpaValue))}
      </td>
      <td className="py-2.5 text-right tabular-nums">
        {conv == null ? <NotApplicable /> : formatPercent(conv)}
      </td>
    </>
  );
}

function MoneyCell({ paise, na }: { paise?: number; na?: boolean }) {
  return (
    <td className="py-2.5 pr-4 text-right tabular-nums">
      {na || paise == null ? <NotApplicable /> : formatINR(paise)}
    </td>
  );
}

function RowBadges({ row }: { row: AdsBreakdownRow }) {
  return (
    <>
      {row.name_matched && (
        <span
          title="Attributed by ad name, not ad id — names are not unique, so treat as approximate"
          className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
        >
          ≈ name
        </span>
      )}
      {row.has_test && <StatusBadge status="warning" label="Test" />}
    </>
  );
}

function DataRow({
  row,
  depth,
  label,
  expandable,
  isOpen,
  onToggle,
  thumbnailUrl,
}: {
  row: AdsBreakdownRow;
  depth: 0 | 1 | 2;
  label: string;
  expandable: boolean;
  isOpen: boolean;
  onToggle: () => void;
  thumbnailUrl?: string;
}) {
  return (
    <tr className="border-b border-white/5 text-slate-300 transition-colors last:border-0 hover:bg-white/3">
      <td className="py-2.5 pr-4">
        <div
          className={cn(
            "flex items-center gap-2",
            depth === 1 && "pl-6",
            depth === 2 && "pl-12",
          )}
        >
          {expandable ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              className="rounded p-0.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
            >
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={cn("transition-transform", isOpen && "rotate-90")}
              />
            </button>
          ) : (
            <span className="w-5" />
          )}
          {depth === 2 &&
            (thumbnailUrl != null ? (
              // Signed URL from the private bucket — plain img, remote
              // next/image is pointless for a 1h-expiring URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt=""
                className="size-7 shrink-0 rounded-md border border-white/10 object-cover"
              />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-600">
                <ImageOff size={12} aria-hidden="true" />
              </span>
            ))}
          <span
            className={cn(
              "truncate",
              depth === 0 ? "font-medium text-white" : "text-slate-400",
            )}
            title={label}
          >
            {label}
          </span>
          <RowBadges row={row} />
        </div>
      </td>
      <MoneyCell paise={row.spend_paise} />
      <MoneyCell paise={row.l1_revenue_paise} />
      <MoneyCell paise={row.l2_revenue_paise} />
      <RatioCells row={row} />
    </tr>
  );
}

export function AdsDrilldownTable({
  rows,
  thumbnailUrls,
  spendUntrackedPaise,
  unattributedL1RevenuePaise,
  unattributedL1Count,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const campaigns = rows.filter((r) => r.tier === "campaign");
  const adsetsByCampaign = new Map<string | null, AdsBreakdownRow[]>();
  for (const r of rows.filter((x) => x.tier === "adset")) {
    const list = adsetsByCampaign.get(r.campaign_key) ?? [];
    list.push(r);
    adsetsByCampaign.set(r.campaign_key, list);
  }
  const adsByAdset = new Map<string, AdsBreakdownRow[]>();
  for (const r of rows.filter((x) => x.tier === "ad")) {
    const k = `${r.campaign_key ?? "∅"}:${r.adset_key ?? "∅"}`;
    const list = adsByAdset.get(k) ?? [];
    list.push(r);
    adsByAdset.set(k, list);
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const visible: React.ReactNode[] = [];
  for (const campaign of campaigns) {
    const campaignKey = keyOf(campaign);
    const campaignOpen = expanded.has(campaignKey);
    const campaignAdsets = adsetsByCampaign.get(campaign.campaign_key) ?? [];
    visible.push(
      <DataRow
        key={campaignKey}
        row={campaign}
        depth={0}
        label={campaign.campaign_name ?? campaign.campaign_key ?? UNATTRIBUTED_LABEL}
        expandable={campaignAdsets.length > 0}
        isOpen={campaignOpen}
        onToggle={() => toggle(campaignKey)}
      />,
    );
    if (!campaignOpen) continue;
    for (const adset of campaignAdsets) {
      const adsetKey = keyOf(adset);
      const adsetOpen = expanded.has(adsetKey);
      const ads =
        adsByAdset.get(`${adset.campaign_key ?? "∅"}:${adset.adset_key ?? "∅"}`) ?? [];
      visible.push(
        <DataRow
          key={adsetKey}
          row={adset}
          depth={1}
          label={adset.adset_name ?? adset.adset_key ?? UNATTRIBUTED_LABEL}
          expandable={ads.length > 0}
          isOpen={adsetOpen}
          onToggle={() => toggle(adsetKey)}
        />,
      );
      if (!adsetOpen) continue;
      for (const ad of ads) {
        visible.push(
          <DataRow
            key={keyOf(ad)}
            row={ad}
            depth={2}
            label={ad.ad_name ?? ad.ad_key ?? UNATTRIBUTED_LABEL}
            expandable={false}
            isOpen={false}
            onToggle={() => undefined}
            thumbnailUrl={ad.ad_key != null ? thumbnailUrls[ad.ad_key] : undefined}
          />,
        );
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          Campaigns
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          Expand to ad sets and ads · revenue attributed by Trace, spend
          reported by Meta
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-200 text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2.5 pr-4 font-medium">Name</th>
              <th className="py-2.5 pr-4 text-right font-medium">Meta spend</th>
              <th className="py-2.5 pr-4 text-right font-medium">L1 revenue</th>
              <th className="py-2.5 pr-4 text-right font-medium">L2 revenue</th>
              <th className="py-2.5 pr-4 text-right font-medium">ROAS (L1+L2)</th>
              <th className="py-2.5 pr-4 text-right font-medium">CPA (L1)</th>
              <th className="py-2.5 text-right font-medium">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  Synced, but no spend or attributed activity in this range.
                </td>
              </tr>
            )}
            {visible}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 text-slate-400">
              <td className="py-2.5 pr-4">
                <span title="Ads with Meta spend whose ad id matches no tracked session in this range">
                  Spend, no tracked sessions
                </span>
              </td>
              <MoneyCell paise={spendUntrackedPaise} />
              <MoneyCell na />
              <MoneyCell na />
              <td className="py-2.5 pr-4 text-right"><NotApplicable /></td>
              <td className="py-2.5 pr-4 text-right"><NotApplicable /></td>
              <td className="py-2.5 text-right"><NotApplicable /></td>
            </tr>
            <tr className="text-slate-400">
              <td className="py-2.5 pr-4">
                <span title="Paid revenue whose attribution resolved to no ad">
                  Unattributed revenue
                  {unattributedL1Count > 0 && (
                    <span className="ml-1.5 text-slate-600">
                      ({formatCount(unattributedL1Count)} payments)
                    </span>
                  )}
                </span>
              </td>
              <MoneyCell na />
              <MoneyCell paise={unattributedL1RevenuePaise} />
              <MoneyCell na />
              <td className="py-2.5 pr-4 text-right"><NotApplicable /></td>
              <td className="py-2.5 pr-4 text-right"><NotApplicable /></td>
              <td className="py-2.5 text-right"><NotApplicable /></td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

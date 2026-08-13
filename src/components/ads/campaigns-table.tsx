"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCount, formatINR } from "@/lib/format";
import { UNATTRIBUTED_LABEL } from "@/lib/metrics/attribution";
import { cpa, roas } from "@/lib/metrics/definitions";
import type { AdsBreakdownRow } from "@/lib/queries/ads";
import type { RangePreset } from "@/lib/range";

/**
 * The Campaigns view: one row per campaign, five decision metrics
 * (Spend · L1 · L2 · ROAS · CPA), row click drills into the Ads view filtered
 * to that campaign. Null-key row is the Unattributed bucket — shown, never
 * dropped, and not clickable (it has no ads to drill into).
 *
 * Ratio cells render "n/a" when the denominator is zero — never a zero or a
 * dash that reads as zero, because "this campaign failed" and "this campaign
 * was not tracked" imply opposite actions. ROAS carries no good/bad colour:
 * colour is reserved for semantic status.
 *
 * The two reconciliation rows are always present, even at zero, so their
 * absence never reads as "there is no gap": spend the tracker never saw a
 * session for, and paid revenue no ad can claim. With them, the spend column
 * totals real spend and the revenue columns total real revenue.
 */

type Props = {
  rows: AdsBreakdownRow[];
  range: RangePreset;
  spendUntrackedPaise: number;
  unattributedL1RevenuePaise: number;
  unattributedL1Count: number;
};

function NotApplicable() {
  return (
    <span className="text-slate-600" title="Not applicable — no data to compute this from">
      n/a
    </span>
  );
}

function MoneyCell({
  paise,
  count,
  na,
  last,
}: {
  paise?: number;
  count?: number;
  na?: boolean;
  last?: boolean;
}) {
  return (
    <td className={`py-3 text-right tabular-nums ${last ? "" : "pr-4"}`}>
      {na || paise == null ? (
        <NotApplicable />
      ) : (
        <>
          {formatINR(paise)}
          {count != null && (
            <span className="ml-1 text-slate-500">({formatCount(count)})</span>
          )}
        </>
      )}
    </td>
  );
}

export function CampaignsTable({
  rows,
  range,
  spendUntrackedPaise,
  unattributedL1RevenuePaise,
  unattributedL1Count,
}: Props) {
  const router = useRouter();
  const campaigns = rows.filter((r) => r.tier === "campaign");

  function adsHref(campaignKey: string) {
    return `/ads?tab=ads&campaign=${encodeURIComponent(campaignKey)}&range=${range}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">Campaigns</CardTitle>
        <CardDescription className="text-sm text-slate-400">
          Click a campaign to see its ads · revenue attributed by Trace, spend
          reported by Meta
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-200 text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2.5 pr-4 font-medium">Campaign</th>
              <th className="py-2.5 pr-4 text-right font-medium">Meta spend</th>
              <th className="py-2.5 pr-4 text-right font-medium">L1 revenue</th>
              <th className="py-2.5 pr-4 text-right font-medium">L2 revenue</th>
              <th className="py-2.5 pr-4 text-right font-medium">ROAS (L1+L2)</th>
              <th className="py-2.5 text-right font-medium">CPA (L1)</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Synced, but no spend or attributed activity in this range.
                </td>
              </tr>
            )}
            {campaigns.map((row) => {
              const clickable = row.campaign_key != null;
              const label = row.campaign_name ?? row.campaign_key ?? UNATTRIBUTED_LABEL;
              const totalRevenue = row.l1_revenue_paise + row.l2_revenue_paise;
              const roasValue = roas(totalRevenue, row.spend_paise);
              const cpaValue = cpa(row.spend_paise, row.l1_paid_count);
              return (
                <tr
                  key={row.campaign_key ?? "∅"}
                  onClick={
                    clickable ? () => router.push(adsHref(row.campaign_key!)) : undefined
                  }
                  className={`border-b border-white/5 text-slate-300 transition-colors last:border-0 ${
                    clickable ? "cursor-pointer hover:bg-white/3" : ""
                  }`}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      {clickable ? (
                        <Link
                          href={adsHref(row.campaign_key!)}
                          onClick={(e) => e.stopPropagation()}
                          className="truncate font-medium text-white hover:text-indigo-300"
                          title={label}
                        >
                          {label}
                        </Link>
                      ) : (
                        <span
                          className="truncate font-medium text-slate-400"
                          title="Sessions or payments whose attribution resolved to no campaign"
                        >
                          {label}
                        </span>
                      )}
                      {row.name_matched && (
                        <span
                          title="Attributed by ad name, not ad id — names are not unique, so treat as approximate"
                          className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                        >
                          ≈ name
                        </span>
                      )}
                      {row.has_test && <StatusBadge status="warning" label="Test" />}
                      {clickable && (
                        <ChevronRight
                          size={14}
                          aria-hidden="true"
                          className="ml-auto shrink-0 text-slate-600"
                        />
                      )}
                    </div>
                  </td>
                  <MoneyCell paise={row.spend_paise} />
                  <MoneyCell paise={row.l1_revenue_paise} count={row.l1_paid_count} />
                  <MoneyCell paise={row.l2_revenue_paise} count={row.l2_count} />
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {roasValue == null ? <NotApplicable /> : `${roasValue.toFixed(2)}×`}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {cpaValue == null ? <NotApplicable /> : formatINR(Math.round(cpaValue))}
                  </td>
                </tr>
              );
            })}
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
              <td className="py-2.5 text-right"><NotApplicable /></td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

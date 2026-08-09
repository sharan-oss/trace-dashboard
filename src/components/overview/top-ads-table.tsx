import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCount, formatINR } from "@/lib/format";
import { groupWithUnattributed } from "@/lib/metrics/attribution";
import type { TopAdRow } from "@/lib/queries/overview";

/**
 * Top 5 ads by attributed L1+L2 revenue. Ordering and the always-last
 * Unattributed bucket come from the existing groupWithUnattributed helper —
 * its contract guarantees the buckets reconcile to the true total. Ad names
 * are NOT unique (the top two Love School ads share one), so a campaign
 * subtitle always renders, and a shortened ad id is appended whenever a
 * rendered name repeats.
 *
 * Table styling per design system §3.7: text-xs, white/10 header line,
 * white/5 row dividers, numbers right-aligned, the highlight column (L2 —
 * the acquisition story) tinted indigo-300.
 */
export function TopAdsTable({ rows }: { rows: TopAdRow[] }) {
  const groups = groupWithUnattributed(
    rows,
    (r) => r.ad_key,
    (r) => r.l1_revenue_paise + r.l2_revenue_paise,
  );

  const byKey = new Map(rows.map((r) => [r.ad_key, r]));
  const top = groups
    .filter((g) => !g.isUnattributed)
    .slice(0, 5)
    .map((g) => byKey.get(g.key))
    .filter((r): r is TopAdRow => r != null);
  const unattributed = groups.find((g) => g.isUnattributed);
  const unattributedRow = byKey.get(null);

  const nameCounts = new Map<string, number>();
  for (const r of top) {
    if (r.ad_name != null) {
      nameCounts.set(r.ad_name, (nameCounts.get(r.ad_name) ?? 0) + 1);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          Top performing ads
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          By attributed revenue — L2 credited to the ad behind the
          customer&apos;s first purchase
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-140 text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="w-10 px-2 py-2.5 font-medium">#</th>
              <th className="py-2.5 pr-4 font-medium">Ad</th>
              <th className="py-2.5 pr-4 text-right font-medium">L1 revenue</th>
              <th className="py-2.5 pr-4 text-right font-medium">L2 revenue</th>
              <th className="py-2.5 text-right font-medium">Customers</th>
            </tr>
          </thead>
          <tbody>
            {top.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  No attributed ads in this range
                </td>
              </tr>
            )}
            {top.map((r, i) => {
              const collides =
                r.ad_name == null || (nameCounts.get(r.ad_name) ?? 0) > 1;
              return (
                <tr
                  key={r.ad_key}
                  className="border-b border-white/5 text-slate-300 transition-colors last:border-0 hover:bg-white/3"
                >
                  <td className="px-2 py-3">
                    <span className="flex size-6 items-center justify-center rounded-md border border-white/10 bg-white/5 font-mono text-slate-400">
                      {i + 1}
                    </span>
                  </td>
                  <td className="max-w-70 py-3 pr-4">
                    <p className="truncate text-sm font-medium text-white">
                      {r.ad_name ?? r.ad_key}
                      {collides && r.ad_key != null && (
                        <span className="ml-1.5 font-mono text-xs text-slate-500">
                          …{r.ad_key.slice(-6)}
                        </span>
                      )}
                    </p>
                    {r.campaign_name != null && (
                      <p className="truncate text-xs text-slate-500">
                        {r.campaign_name}
                      </p>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums">
                    {formatINR(r.l1_revenue_paise)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums text-indigo-300">
                    {formatINR(r.l2_revenue_paise)}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums text-slate-400">
                    {formatCount(r.customers_count)}
                  </td>
                </tr>
              );
            })}
            {unattributed != null && unattributed.value > 0 && (
              <tr className="text-slate-500">
                <td className="px-2 py-3" />
                <td className="py-3 pr-4">
                  <p className="text-sm font-medium">{unattributed.label}</p>
                </td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums">
                  {formatINR(unattributedRow?.l1_revenue_paise ?? 0)}
                </td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums">
                  {formatINR(unattributedRow?.l2_revenue_paise ?? 0)}
                </td>
                <td className="py-3 text-right font-mono tabular-nums">
                  {formatCount(unattributedRow?.customers_count ?? 0)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
      <CardFooter>
        <Link
          href="/ads"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-white"
        >
          View all ads
          <ArrowRight size={13} />
        </Link>
      </CardFooter>
    </Card>
  );
}

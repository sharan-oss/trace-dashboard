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
        <CardTitle className="font-heading text-base">
          Top performing ads
        </CardTitle>
        <CardDescription>
          By attributed revenue — L2 credited to the ad behind the
          customer&apos;s first purchase
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[540px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Ad</th>
              <th className="pb-2 pr-4 text-right font-medium">L1 revenue</th>
              <th className="pb-2 pr-4 text-right font-medium">L2 revenue</th>
              <th className="pb-2 text-right font-medium">Customers</th>
            </tr>
          </thead>
          <tbody>
            {top.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  No attributed ads in this range
                </td>
              </tr>
            )}
            {top.map((r) => {
              const collides =
                r.ad_name == null || (nameCounts.get(r.ad_name) ?? 0) > 1;
              return (
                <tr key={r.ad_key} className="border-b border-border/60">
                  <td className="max-w-[280px] py-3 pr-4">
                    <p className="truncate font-medium">
                      {r.ad_name ?? r.ad_key}
                      {collides && r.ad_key != null && (
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                          …{r.ad_key.slice(-6)}
                        </span>
                      )}
                    </p>
                    {r.campaign_name != null && (
                      <p className="truncate text-xs text-muted-foreground">
                        {r.campaign_name}
                      </p>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums">
                    {formatINR(r.l1_revenue_paise)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums">
                    {formatINR(r.l2_revenue_paise)}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums">
                    {formatCount(r.customers_count)}
                  </td>
                </tr>
              );
            })}
            {unattributed != null && unattributed.value > 0 && (
              <tr className="text-muted-foreground">
                <td className="py-3 pr-4">
                  <p className="font-medium">{unattributed.label}</p>
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
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View all ads
          <ArrowRight className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

import { AdPeek } from "@/components/customers/ad-peek";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { avatarDataUri } from "@/lib/avatars";
import type { AdCreativeMeta } from "@/lib/creatives";
import { formatCount, formatDays, formatINR } from "@/lib/format";
import type { TopCustomerRow } from "@/lib/queries/customers";

/**
 * The highest-value customers, with faces.
 *
 * The concentration bar proves a ratio; this makes it concrete. When roughly 3%
 * of customers carry two thirds of revenue, "your revenue is these people" is
 * the literal truth, and a row of individuals says it in a way another number
 * cannot. Avatars are generated locally from the customer UUID (see
 * lib/avatars.ts) — illustrated characters, never photographs, and no personal
 * data leaves the app to produce them.
 *
 * "via <ad>" is the payoff of the whole product: the ad that bought a customer
 * who went on to spend this much. Customers whose acquiring payment resolved no
 * ad say so plainly rather than being hidden.
 */
export function TopCustomersStrip({
  rows,
  creativeMeta,
}: {
  rows: TopCustomerRow[];
  creativeMeta: Record<string, AdCreativeMeta>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          Highest-value customers
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          Lifetime spend across both Trace checkout and upsells, with the ad that
          acquired them
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No customers acquired in this range.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {rows.map((row) => (
              <li
                key={row.customer_id}
                className="w-[calc(50%-0.375rem)] rounded-xl border border-border bg-white/5 p-3 backdrop-blur-md sm:w-44"
              >
                <div className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- inline
                      data URI, generated in-process; there is nothing for the
                      image optimiser to fetch or cache. */}
                  <img
                    src={avatarDataUri(row.customer_id)}
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 shrink-0 rounded-full"
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium text-white"
                      title={row.name || "Unnamed customer"}
                    >
                      {row.name || "Unnamed customer"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatCount(row.purchase_count)}{" "}
                      {row.purchase_count === 1 ? "purchase" : "purchases"}
                    </p>
                  </div>
                </div>

                <p className="mt-3 font-heading text-lg font-bold tracking-tight text-white tabular-nums">
                  {formatINR(row.lifetime_paise)}
                </p>

                {row.days_to_second != null && (
                  <p className="mt-0.5 text-[11px] text-indigo-300/80">
                    bought again in {formatDays(row.days_to_second)}
                  </p>
                )}

                <p className="mt-2 truncate text-[11px] text-slate-500">
                  {row.ad_name ?? row.ad_key ? (
                    <>
                      via{" "}
                      <AdPeek
                        label={row.ad_name ?? (row.ad_key as string)}
                        meta={
                          row.ad_key != null
                            ? (creativeMeta[row.ad_key] ?? null)
                            : null
                        }
                      />
                    </>
                  ) : (
                    <span className="text-slate-600">no ad resolved</span>
                  )}
                </p>

                {row.has_test && (
                  <div className="mt-2">
                    <StatusBadge status="warning" label="Test" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

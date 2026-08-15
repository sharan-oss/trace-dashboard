import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCount, formatINR, formatPercent } from "@/lib/format";
import { UNATTRIBUTED_LABEL } from "@/lib/metrics/attribution";
import {
  cac,
  isRateReadable,
  ltvCac,
  repeatRate,
} from "@/lib/metrics/definitions";
import type { CustomersByAdRow } from "@/lib/queries/customers";

/**
 * Acquisition quality per ad: not "which ad sold the most", which /ads already
 * answers, but "which ad bought customers who came back".
 *
 * This is the join no other tool in these clients' stacks can make — Meta knows
 * the spend, the gateway knows the upsell, and only Trace knows they belong to
 * the same person. LTV:CAC is the column that matters; everything else is there
 * so the reader can see how it was built.
 *
 * Two rows people expect to be missing, and must not be:
 *   * the null-key Unattributed bucket — customers whose acquiring payment
 *     resolved no ad. Dropping it would silently shrink the customer total.
 *   * ads with spend but zero customers — money that bought nobody, which is a
 *     finding, not an empty row.
 *
 * Rates below MIN_DENOMINATOR_FOR_RATE render muted: 14 repeat buyers spread
 * across 10 ads makes every per-ad repeat rate noise. The counts stay at full
 * strength, because a count is a fact at any n — it is the ratio that lies.
 */

const MAX_ROWS = 25;

function NotApplicable({ title }: { title?: string }) {
  return (
    <span
      className="text-slate-600"
      title={title ?? "Not applicable — no data to compute this from"}
    >
      n/a
    </span>
  );
}

export function AcquisitionTable({ rows }: { rows: CustomersByAdRow[] }) {
  const unattributed = rows.filter((r) => r.ad_key == null);
  const attributed = rows.filter((r) => r.ad_key != null);

  // Rows arrive sorted by cohort value. Cap the attributed ones, but never the
  // Unattributed bucket, and say out loud what was dropped — a silent top-N
  // reads as "this is everything" when it is not.
  const shown = attributed.slice(0, MAX_ROWS);
  const hidden = attributed.length - shown.length;
  const hiddenCustomers = attributed
    .slice(MAX_ROWS)
    .reduce((t, r) => t + r.customers, 0);

  const totals = rows.reduce(
    (t, r) => ({
      customers: t.customers + r.customers,
      repeaters: t.repeaters + r.repeat_customers,
      ltv: t.ltv + r.cohort_lifetime_paise,
      spend: t.spend + r.spend_paise,
    }),
    { customers: 0, repeaters: 0, ltv: 0, spend: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          Acquisition quality by ad
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          What each ad actually bought — customers, what they went on to spend,
          and whether that beat what it cost
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-200 text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2.5 pr-4 font-medium">Ad</th>
              <th className="py-2.5 pr-4 text-right font-medium">Customers</th>
              <th className="py-2.5 pr-4 text-right font-medium">Meta spend</th>
              <th className="py-2.5 pr-4 text-right font-medium">CAC</th>
              <th className="py-2.5 pr-4 text-right font-medium">Repeat</th>
              <th className="py-2.5 pr-4 text-right font-medium">Cohort LTV</th>
              <th className="py-2.5 text-right font-medium">LTV:CAC</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No customers acquired and no spend in this range.
                </td>
              </tr>
            )}
            {[...shown, ...unattributed].map((row) => (
              <Row key={row.ad_key ?? "∅"} row={row} />
            ))}
          </tbody>
          <tfoot>
            {hidden > 0 && (
              <tr className="border-t border-white/10 text-slate-500">
                <td colSpan={7} className="py-2.5 text-xs">
                  {formatCount(hidden)} further{" "}
                  {hidden === 1 ? "ad" : "ads"} with lower cohort value not
                  shown ({formatCount(hiddenCustomers)} customers). Totals below
                  include them.
                </td>
              </tr>
            )}
            <tr className="border-t border-white/10 font-medium text-slate-300">
              <td className="py-2.5 pr-4">Total</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatCount(totals.customers)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatINR(totals.spend)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {renderRatio(cac(totals.spend, totals.customers), (v) =>
                  formatINR(Math.round(v)),
                )}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                <RepeatCell
                  repeaters={totals.repeaters}
                  customers={totals.customers}
                />
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatINR(totals.ltv)}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {renderRatio(
                  ltvCac(totals.ltv, totals.spend),
                  (v) => `${v.toFixed(2)}×`,
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

function renderRatio(
  value: number | null,
  format: (v: number) => string,
): React.ReactNode {
  return value == null ? <NotApplicable /> : format(value);
}

function RepeatCell({
  repeaters,
  customers,
}: {
  repeaters: number;
  customers: number;
}) {
  const rate = repeatRate(repeaters, customers);
  if (rate == null) return <NotApplicable />;
  const readable = isRateReadable(customers);
  return (
    <>
      {formatCount(repeaters)}
      <span
        className={readable ? "ml-1 text-slate-500" : "ml-1 text-slate-600"}
        title={
          readable
            ? undefined
            : `Only ${formatCount(customers)} customers — too few for this rate to mean anything`
        }
      >
        ({formatPercent(rate, 0)})
      </span>
    </>
  );
}

function Row({ row }: { row: CustomersByAdRow }) {
  const isUnattributed = row.ad_key == null;
  const label = row.ad_name ?? row.ad_key ?? UNATTRIBUTED_LABEL;
  const cacValue = cac(row.spend_paise, row.customers);
  const ltvCacValue = ltvCac(row.cohort_lifetime_paise, row.spend_paise);
  const spentNothingGained = row.spend_paise > 0 && row.customers === 0;

  return (
    <tr className="border-b border-white/5 text-slate-300 last:border-0">
      <td className="max-w-80 py-3 pr-4">
        <div className="truncate">
          <span
            className={
              isUnattributed
                ? "font-medium text-slate-400"
                : "font-medium text-white"
            }
            title={
              isUnattributed
                ? "Customers whose acquiring payment resolved to no ad"
                : (row.campaign_name ?? label)
            }
          >
            {label}
          </span>
          {spentNothingGained && (
            <span
              className="ml-2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
              title="This ad spent money in this range and acquired no customers"
            >
              no customers
            </span>
          )}
        </div>
        {row.campaign_name != null && (
          <p className="truncate text-[11px] text-slate-600">
            {row.campaign_name}
          </p>
        )}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        {formatCount(row.customers)}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        {isUnattributed ? (
          <NotApplicable title="Unattributed customers have no ad, so no spend to charge them to" />
        ) : (
          formatINR(row.spend_paise)
        )}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        {renderRatio(cacValue, (v) => formatINR(Math.round(v)))}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        <RepeatCell repeaters={row.repeat_customers} customers={row.customers} />
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        {formatINR(row.cohort_lifetime_paise)}
      </td>
      <td className="py-3 text-right tabular-nums">
        {renderRatio(ltvCacValue, (v) => `${v.toFixed(2)}×`)}
      </td>
    </tr>
  );
}

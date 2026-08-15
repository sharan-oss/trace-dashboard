import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { AdPeek } from "@/components/customers/ad-peek";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AdCreativeMeta } from "@/lib/creatives";
import { formatCount, formatPercent } from "@/lib/format";
import { UNATTRIBUTED_LABEL } from "@/lib/metrics/attribution";
import { isRateReadable } from "@/lib/metrics/definitions";
import type { FunnelLens, FunnelSegmentRow } from "@/lib/queries/funnel";
import type { RangePreset } from "@/lib/range";
import { cn } from "@/lib/utils";

/**
 * The lens table — the page's argument in table form:
 *   campaign lens = same page, different traffic → differences are the ad's fault
 *   page lens     = same traffic, different page → differences are the page's fault
 * product is the owner's coarse cut; the ad lens is the drill inside one
 * campaign (URL-driven, ?lens=ad&campaign=…, the /ads pattern), where the ad
 * names carry AdPeek creative previews.
 *
 * Every rate renders with its count beside it, and rates on segments under the
 * n≥20 floor render muted — a 40% form-open rate on 5 sessions is noise wearing
 * a percentage. The null-key bucket row is always present, and the footer
 * totals reconcile to the stage card exactly (asserted by test).
 */

const LENSES: { value: FunnelLens; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "page", label: "Landing page" },
  { value: "product", label: "Product" },
];

const BUCKET_LABEL: Record<FunnelLens, string> = {
  campaign: UNATTRIBUTED_LABEL,
  ad: UNATTRIBUTED_LABEL,
  page: "Unknown page",
  product: "No product",
};

const BUCKET_TITLE: Record<FunnelLens, string> = {
  campaign: "Sessions whose attribution resolved to no campaign",
  ad: "Sessions in this campaign that resolved to no specific ad",
  page: "Sessions with no landing URL recorded",
  product: "Sessions with no product recorded",
};

function RateCell({
  reached,
  sessions,
}: {
  reached: number;
  sessions: number;
}) {
  const readable = isRateReadable(sessions);
  return (
    <td className="py-3 pr-4 text-right tabular-nums">
      {formatCount(reached)}
      <span
        className={cn("ml-1", readable ? "text-slate-500" : "text-slate-600")}
        title={
          readable
            ? undefined
            : `Only ${formatCount(sessions)} sessions — too few for this rate to mean anything`
        }
      >
        ({sessions > 0 ? formatPercent(reached / sessions) : "—"})
      </span>
    </td>
  );
}

export function FunnelSegments({
  lens,
  rows,
  range,
  campaignKey,
  campaignLabel,
  creativeMeta,
}: {
  lens: FunnelLens;
  rows: FunnelSegmentRow[];
  range: RangePreset;
  /** Set when lens === "ad": the campaign being drilled into. */
  campaignKey: string | null;
  campaignLabel: string | null;
  creativeMeta: Record<string, AdCreativeMeta>;
}) {
  const totals = rows.reduce(
    (t, r) => ({
      sessions: t.sessions + r.sessions,
      form_open: t.form_open + r.reached_form_open,
      form_submit: t.form_submit + r.reached_form_submit,
      paid: t.paid + r.reached_payment_complete,
    }),
    { sessions: 0, form_open: 0, form_submit: 0, paid: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">
          {lens === "ad" ? (
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={`/funnel?lens=campaign&range=${range}`}
                className="flex items-center gap-1 text-sm font-medium text-slate-400 transition-colors hover:text-white"
              >
                <ArrowLeft size={14} aria-hidden="true" />
                Campaigns
              </Link>
              <span className="text-slate-600">/</span>
              <span className="min-w-0 truncate" title={campaignLabel ?? undefined}>
                {campaignLabel ?? campaignKey}
              </span>
            </span>
          ) : (
            "Who leaks where"
          )}
        </CardTitle>
        <CardDescription className="text-sm text-slate-400">
          {lens === "campaign" &&
            "Same page, different traffic — differences here are the ad's doing"}
          {lens === "ad" && "Ads inside this campaign — hover a name for the creative"}
          {lens === "page" &&
            "Same traffic, different page — differences here are the page's doing"}
          {lens === "product" && "One funnel per product"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lens !== "ad" && (
          <nav
            aria-label="Funnel lens"
            className="mb-4 inline-flex w-fit items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5"
          >
            {LENSES.map((l) => (
              <Link
                key={l.value}
                href={`/funnel?lens=${l.value}&range=${range}`}
                aria-current={lens === l.value ? "page" : undefined}
                className={cn(
                  "rounded-md px-4 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                  lens === l.value
                    ? "bg-accent text-accent-foreground"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-170 text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">
                  {lens === "ad" ? "Ad" : LENSES.find((l) => l.value === lens)?.label}
                </th>
                <th className="py-2.5 pr-4 text-right font-medium">Sessions</th>
                <th className="py-2.5 pr-4 text-right font-medium">Form opened</th>
                <th className="py-2.5 pr-4 text-right font-medium">Form submitted</th>
                <th className="py-2.5 pr-4 text-right font-medium">Paid</th>
                <th className="w-6 py-2.5" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No sessions in this range.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const isBucket = row.segment_key == null;
                const label = isBucket
                  ? BUCKET_LABEL[lens]
                  : (row.segment_label ?? row.segment_key);
                const drillable = lens === "campaign" && !isBucket;
                return (
                  <tr
                    key={row.segment_key ?? "∅"}
                    className="border-b border-white/5 text-slate-300 last:border-0"
                  >
                    <td className="max-w-90 py-3 pr-4">
                      <span className="block truncate">
                        {isBucket ? (
                          <span
                            className="font-medium text-slate-400"
                            title={BUCKET_TITLE[lens]}
                          >
                            {label}
                          </span>
                        ) : lens === "ad" ? (
                          <AdPeek
                            label={label as string}
                            meta={creativeMeta[row.segment_key as string] ?? null}
                            className="cursor-help font-medium text-white underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-indigo-400/60"
                          />
                        ) : drillable ? (
                          <Link
                            href={`/funnel?lens=ad&campaign=${encodeURIComponent(row.segment_key as string)}&range=${range}`}
                            className="font-medium text-white hover:text-indigo-300"
                            title={label as string}
                          >
                            {label}
                          </Link>
                        ) : (
                          <span className="font-medium text-white" title={label as string}>
                            {label}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {formatCount(row.sessions)}
                    </td>
                    <RateCell reached={row.reached_form_open} sessions={row.sessions} />
                    <RateCell reached={row.reached_form_submit} sessions={row.sessions} />
                    <RateCell reached={row.reached_payment_complete} sessions={row.sessions} />
                    <td className="py-3 text-right">
                      {drillable && (
                        <ChevronRight
                          size={14}
                          aria-hidden="true"
                          className="inline text-slate-600"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-medium text-slate-300">
                <td className="py-2.5 pr-4">Total</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">
                  {formatCount(totals.sessions)}
                </td>
                <RateCell reached={totals.form_open} sessions={totals.sessions} />
                <RateCell reached={totals.form_submit} sessions={totals.sessions} />
                <RateCell reached={totals.paid} sessions={totals.sessions} />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

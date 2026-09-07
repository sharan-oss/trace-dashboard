"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCount, formatDayRange, formatDayShort, formatINR } from "@/lib/format";
import type { DayPaymentRow, RevenueDailyRow } from "@/lib/queries/overview";
import type { DateWindow } from "@/lib/range";
import { cn } from "@/lib/utils";

/**
 * The payments behind one point on the revenue graph, scoped by PAYMENT DAY.
 *
 * This exists because the graph and Customers -> People deliberately disagree:
 * the graph buckets a payment on the day it was paid, while People buckets a
 * person on the day they were FIRST acquired. On 2026-09-06 that read as "six
 * upsells on the chart, four in the customers table" — both correct, neither
 * explaining itself. The "acquired" line on each L2 row is what closes that
 * loop, so do not drop it.
 *
 * The header totals come from the graph's OWN row, not from summing the list,
 * so the header cannot contradict the chart even if p_limit ever truncated the
 * rows. Opened by ?day=YYYY-MM-DD, so a day is a shareable URL; the server page
 * fetches and this component only presents. Built on base-ui Dialog exactly as
 * CustomerSheet is — a right-anchored panel is a dialog positioned right.
 */

const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
});

/** Gateway/source slug → what actually happened, in the user's words. */
function originLabel(row: DayPaymentRow): string {
  if (row.arm === "l1") return "Trace checkout";
  switch (row.source) {
    case "manual":
      return "Recorded by hand";
    case "tagmango":
      return "TagMango";
    default:
      return "Payment link";
  }
}

function originTitle(row: DayPaymentRow): string {
  if (row.arm === "l1") return "Paid through Trace's checkout";
  return row.source === "manual"
    ? "Paid off-platform and entered by hand"
    : "Paid outside Trace's checkout, matched to this person by email or phone";
}

function PaymentRow({
  row,
  day,
  earlyThan,
}: {
  row: DayPaymentRow;
  /** The day being drilled into — an acquired day equal to it says nothing. */
  day: string;
  /** Range start; an acquired day before this is the row People omits. */
  earlyThan: string | null;
}) {
  const isL2 = row.arm === "l2";
  const early =
    earlyThan != null &&
    row.acquired_day_ist != null &&
    row.acquired_day_ist < earlyThan;
  // Suppressed when this payment IS the acquisition: "acquired 6 Sep" on a row
  // paid 6 Sep is noise. What remains is signal — a repeat purchase.
  const showAcquired =
    row.acquired_day_ist != null && row.acquired_day_ist !== day;

  const name = row.customer_name ?? "Unnamed customer";
  const body = (
    <>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-white">
          <span className="truncate">{name}</span>
          {row.has_test && <StatusBadge status="warning" label="Test" />}
          {row.customer_id != null && (
            <ArrowUpRight
              size={11}
              aria-hidden="true"
              className="shrink-0 text-slate-600 transition-colors group-hover:text-indigo-300"
            />
          )}
        </p>
        {row.customer_email != null && (
          <p className="truncate text-[11px] text-slate-500">{row.customer_email}</p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          <span className="tabular-nums">{time.format(new Date(row.paid_at))}</span>
          <span
            title={originTitle(row)}
            className={cn(
              "rounded border px-1.5 py-px",
              isL2
                ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                : "border-white/10 bg-white/5 text-slate-400",
            )}
          >
            {originLabel(row)}
          </span>
          <span className="truncate">
            {row.ad_name ?? row.ad_key ?? (
              <span className="text-slate-600">Unattributed</span>
            )}
          </span>
        </p>
        {showAcquired && (
          <p
            className={cn(
              "mt-0.5 text-[11px]",
              early ? "text-warning-foreground" : "text-slate-600",
            )}
            title={
              early
                ? "First bought before this range, so Customers → People does not list them here"
                : "The day this person first bought"
            }
          >
            acquired {formatDayShort(row.acquired_day_ist)}
            {early && " — outside this range"}
          </p>
        )}
      </div>
      <p
        className={cn(
          "shrink-0 font-mono text-sm font-semibold tabular-nums",
          isL2 ? "text-indigo-300" : "text-white",
        )}
      >
        {formatINR(row.amount)}
      </p>
    </>
  );

  // Unlinked payments (real, and they count in the graph) have no person to
  // open, so they render as plain rows rather than dead links.
  if (row.customer_id == null) {
    return (
      <li className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2.5 last:border-0">
        {body}
      </li>
    );
  }

  return (
    <li className="border-b border-white/5 last:border-0">
      <Link
        // range=all so the person is guaranteed present in the table behind the
        // sheet; tab=people because CustomerSheet only renders in that branch.
        href={`/customers?tab=people&range=all&customer=${row.customer_id}`}
        className="group flex items-baseline justify-between gap-3 py-2.5 transition-colors hover:bg-white/3"
      >
        {body}
      </Link>
    </li>
  );
}

function Section({
  title,
  caption,
  rows,
  day,
  emptyReason,
  earlyThan,
}: {
  title: string;
  caption: string;
  rows: DayPaymentRow[];
  day: string;
  emptyReason: string;
  earlyThan: string | null;
}) {
  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
        {title}
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{caption}</p>
      <ol className="mt-2">
        {rows.map((row) => (
          <PaymentRow key={row.row_id} row={row} day={day} earlyThan={earlyThan} />
        ))}
        {rows.length === 0 && (
          <li className="py-3 text-xs text-slate-500">{emptyReason}</li>
        )}
      </ol>
    </div>
  );
}

export function DayDetailSheet({
  day,
  totals,
  rows,
  l1Window,
  l2Window,
  truncated,
}: {
  day: string;
  /** The graph's own point for this day — the header reads from this, not the rows. */
  totals: RevenueDailyRow;
  rows: DayPaymentRow[];
  /**
   * The selected L1 window. `from` null means all time; `to` null means
   * unbounded, which is what every preset sends. Used to flag buyers acquired
   * before the range and to explain an empty arm.
   */
  l1Window: { from: string | null; to: string | null };
  /** Non-null means the L2 split window is on. */
  l2Window: DateWindow | null;
  truncated: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("day");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const l1 = rows.filter((r) => r.arm === "l1");
  const l2 = rows.filter((r) => r.arm === "l2");

  // Whether the day itself is in range, compared against the window bounds
  // rather than inferred from an empty list — a day inside the window with no
  // payments is a real, different thing from a day outside it.
  const outsideL1 =
    (l1Window.from != null && day < l1Window.from) ||
    (l1Window.to != null && day > l1Window.to);
  const outsideL2 =
    l2Window != null && (day < l2Window.from || day > l2Window.to);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-white/10 bg-popover p-6 text-popover-foreground outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-white">
                {formatDayShort(day)}
              </Dialog.Title>
              <p className="text-xs text-slate-400">
                Everything paid on this day
              </p>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-white/5 text-slate-400 transition-colors hover:text-white"
            >
              <X size={14} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-white/5 p-4">
              <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                L1
              </p>
              <p className="mt-1 font-heading text-xl font-bold tracking-tight text-white tabular-nums">
                {formatINR(totals.l1_revenue_paise)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {formatCount(l1.length)}{" "}
                {l1.length === 1 ? "purchase" : "purchases"}
              </p>
            </div>
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/6 p-4">
              <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                L2
              </p>
              <p className="mt-1 font-heading text-xl font-bold tracking-tight text-white tabular-nums">
                {formatINR(totals.l2_revenue_paise)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {formatCount(l2.length)} {l2.length === 1 ? "upsell" : "upsells"}
              </p>
            </div>
          </div>

          <Section
            title="First purchases (L1)"
            caption="Paid through Trace's checkout on this day."
            rows={l1}
            day={day}
            emptyReason={
              outsideL1
                ? `${formatDayShort(day)} is outside the selected range, so no L1 payments are counted.`
                : "No L1 payments on this day."
            }
            earlyThan={null}
          />

          <Section
            title="Upsells (L2)"
            caption={
              l2Window == null
                ? "Every captured upsell paid on this day, whoever bought it. Customers → People counts people by the day they were first acquired, so its count for a short range can be lower — the “acquired” line shows which."
                : `L2 is limited to ${formatDayRange(l2Window.from, l2Window.to)}, by buyers acquired in the main range.`
            }
            rows={l2}
            day={day}
            emptyReason={
              outsideL2
                ? `L2 is limited to ${formatDayRange(l2Window!.from, l2Window!.to)} — ${formatDayShort(day)} is outside it.`
                : "No upsells on this day."
            }
            earlyThan={l1Window.from}
          />

          {truncated && (
            <p className="mt-5 rounded-lg border border-warning-foreground/15 bg-warning p-3 text-[11px] text-warning-foreground">
              Showing the first {formatCount(rows.length)} payments for this day.
              The totals above are complete.
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

"use client";

import { Dialog } from "@base-ui/react/dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { AdPeek } from "@/components/customers/ad-peek";
import { StatusBadge } from "@/components/ui/status-badge";
import { avatarDataUri } from "@/lib/avatars";
import type { AdCreativeMeta } from "@/lib/creatives";
import {
  formatCount,
  formatDays,
  formatINR,
} from "@/lib/format";
import type { CustomerDetail } from "@/lib/queries/customers";

/**
 * The receipts view: one customer's full story — every purchase, dated and
 * sourced, plus the ad that started it and the device it happened on. Opened
 * by ?customer=<id>, so a specific person's story is a shareable URL; the
 * server page fetches the detail and this component only presents it.
 *
 * Built on base-ui Dialog rather than Drawer (Drawer's anatomy is a swipeable
 * bottom-sheet stack; a right-anchored panel is just a dialog positioned
 * right). Esc and backdrop close it by clearing the URL param — the dialog has
 * no state of its own.
 *
 * The timeline's job is credibility, so it labels each row's origin: "Trace
 * checkout" rows were captured first-party; "Payment link" rows arrived
 * through the gateway sync and were matched to this person by the identity
 * spine. A null product renders "—", never a guess — that gap is real and
 * belongs to upstream capture.
 */
export function CustomerSheet({
  detail,
  creativeMeta,
}: {
  detail: CustomerDetail;
  creativeMeta: Record<string, AdCreativeMeta>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("customer");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const { customer, timeline, context } = detail;
  const device =
    [context?.device_brand, context?.device_model]
      .filter(Boolean)
      .join(" ") || null;
  const contextBits = [
    device,
    context?.device_os ?? null,
    context?.network_speed_kbps != null
      ? `${formatCount(Math.round(context.network_speed_kbps))} kbps`
      : null,
    context?.visit_count != null
      ? `${formatCount(context.visit_count)} ${
          context.visit_count === 1 ? "visit" : "visits"
        } before buying`
      : null,
  ].filter((b): b is string => b != null);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-white/10 bg-popover p-6 text-popover-foreground outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI */}
              <img
                src={avatarDataUri(customer.customer_id)}
                alt=""
                width={48}
                height={48}
                className="size-12 shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-white">
                  <span className="truncate">{customer.name || "Unnamed customer"}</span>
                  {customer.has_test && <StatusBadge status="warning" label="Test" />}
                </Dialog.Title>
                {customer.email_norm != null && (
                  <p className="truncate text-xs text-slate-400">{customer.email_norm}</p>
                )}
                {customer.phone_norm != null && (
                  <p className="truncate text-xs text-slate-500">{customer.phone_norm}</p>
                )}
              </div>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-white/5 text-slate-400 transition-colors hover:text-white"
            >
              <X size={14} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="mt-5 rounded-xl border border-indigo-500/30 bg-indigo-500/6 p-4">
            <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Lifetime value
            </p>
            <p className="mt-1 font-heading text-3xl font-bold tracking-tight text-white tabular-nums">
              {formatINR(customer.lifetime_paise)}
              <span className="ml-2 text-sm font-normal text-slate-400">
                {formatCount(customer.purchase_count)}{" "}
                {customer.purchase_count === 1 ? "purchase" : "purchases"}
              </span>
            </p>
            {customer.days_to_second != null && (
              <p className="mt-1 text-xs text-indigo-300/80">
                bought again in {formatDays(customer.days_to_second)}
              </p>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Purchases
            </h3>
            <ol className="mt-3 space-y-0">
              {timeline.map((entry, i) => (
                <li
                  key={`${entry.paid_at}-${i}`}
                  className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2.5 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      {entry.product_name ?? (
                        <span
                          className="text-slate-500"
                          title="Product name not captured for this payment"
                        >
                          —
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="tabular-nums">
                        {new Date(entry.paid_at).toLocaleDateString("en-GB", {
                          timeZone: "Asia/Kolkata",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span
                        className={
                          entry.origin === "external"
                            ? "rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-px text-indigo-300"
                            : "rounded border border-white/10 bg-white/5 px-1.5 py-px text-slate-400"
                        }
                        title={
                          entry.origin === "external"
                            ? "Paid outside Trace's checkout (e.g. a payment link), matched to this customer by email/phone"
                            : "Paid through Trace's checkout"
                        }
                      >
                        {entry.origin === "external" ? "Payment link" : "Trace checkout"}
                      </span>
                      {i === 0 &&
                        (customer.ad_key != null || customer.ad_name != null) && (
                          <span className="text-slate-500">
                            via{" "}
                            <AdPeek
                              label={customer.ad_name ?? customer.ad_key ?? ""}
                              meta={
                                customer.ad_key != null
                                  ? (creativeMeta[customer.ad_key] ?? null)
                                  : null
                              }
                            />
                          </span>
                        )}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-white tabular-nums">
                    {formatINR(entry.amount)}
                  </p>
                </li>
              ))}
              {timeline.length === 0 && (
                <li className="py-3 text-sm text-slate-500">
                  No purchases visible for this customer.
                </li>
              )}
            </ol>
          </div>

          {contextBits.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                First-visit context
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {contextBits.join(" · ")}
              </p>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

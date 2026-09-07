"use client";

import { PreviewCard } from "@base-ui/react/preview-card";
import { ExternalLink, ImageOff } from "lucide-react";
import type { AdCreativeMeta } from "@/lib/creatives";

/**
 * An ad name that shows its creative on hover (press-and-hold or tap on
 * touch). An ad name alone — "B1_LMF_AD 6 - 01/12/2025" — tells the reader
 * nothing; the image is the ad. Built on base-ui's PreviewCard: the popup
 * renders in a portal, so the overflow-x-auto table containers cannot clip it.
 *
 * The popup background is SOLID slate-900 (bg-popover), not glass — the design
 * system's rule for anything floating over varied content.
 *
 * `meta` is null when the ads dimension has no row for this key (Occultyogis
 * today): the preview still opens and says so, because a hover that silently
 * does nothing reads as broken.
 *
 * THE POPUP IS CLICKABLE, and deliberately so — it is the one place in this
 * codebase where a hover surface may carry an action. A PreviewCard is built to
 * be entered and stays open while the pointer is inside it, unlike a tooltip,
 * which sets `pointer-events: none` precisely so it cannot be entered (see the
 * comment in revenue-chart-card.tsx). The link lives in the popup rather than
 * on the trigger for two reasons: the popup is portaled, so it can never nest
 * inside the row links that wrap some call sites, and the trigger's existing
 * behaviour stays untouched.
 */

function PeekBody({
  label,
  meta,
}: {
  label: string;
  meta: AdCreativeMeta | null;
}) {
  return (
    <>
      {meta?.thumbUrl != null ? (
        /* eslint-disable-next-line @next/next/no-img-element -- signed
           storage URL with a 1h TTL; the optimizer would re-fetch and
           cache what is deliberately short-lived. */
        <img
          src={meta.thumbUrl}
          alt={meta.adName ?? label}
          width={240}
          height={240}
          className="aspect-square w-full rounded-lg border border-white/10 object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5">
          <ImageOff size={18} className="text-slate-600" aria-hidden="true" />
          <p className="text-[11px] text-slate-500">No creative synced</p>
        </div>
      )}
      <p
        className="mt-2.5 line-clamp-2 text-xs font-medium text-white"
        title={meta?.adName ?? label}
      >
        {meta?.adName ?? label}
      </p>
      {meta?.campaignName != null && (
        <p className="mt-0.5 truncate text-[11px] text-slate-500" title={meta.campaignName}>
          {meta.campaignName}
        </p>
      )}
    </>
  );
}

export function AdPeek({
  label,
  meta,
  className,
}: {
  /** The visible text — the resolved ad name or raw key. */
  label: string;
  meta: AdCreativeMeta | null;
  className?: string;
}) {
  const href = meta?.adsManagerUrl ?? null;

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        render={
          <span
            tabIndex={0}
            className={
              className ??
              "cursor-help underline decoration-white/20 decoration-dotted underline-offset-2 hover:decoration-indigo-400/60"
            }
          >
            {label}
          </span>
        }
      />
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" align="center" sideOffset={8}>
          <PreviewCard.Popup className="z-50 w-64 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-none outline-none">
            {href != null ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              >
                <PeekBody label={label} meta={meta} />
                {/* Stated, not implied: a creative that opens something needs
                    to say where it goes before the click, not after. */}
                <span className="mt-2 flex items-center gap-1 text-[11px] font-medium text-indigo-300">
                  Open in Ads Manager
                  <ExternalLink size={11} aria-hidden="true" />
                </span>
              </a>
            ) : (
              <PeekBody label={label} meta={meta} />
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

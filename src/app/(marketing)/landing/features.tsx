import type * as React from "react";
import { Check } from "lucide-react";

/*
 * Section 5 — "What you'll see in week one" (copy locked in spec).
 * Asymmetric bento: block 2 (Winners ranked by L2 revenue) is the flagship.
 * Tiles are final micro-infographics (decided 2026-08-10: no Gemini images
 * for this section) — illustrative numbers, real enough to read at a glance.
 */

function Tile({
  tall,
  children,
}: {
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded-xl border border-white/10 bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 ${
        tall ? "h-56 sm:h-64" : "h-40 sm:h-44"
      }`}
    >
      {children}
    </div>
  );
}

/* Payment ↔ ad match: every rupee lands on the ad that caused it. */
const MATCHES = [
  { amount: "₹4,999", ad: "Webinar – Hook A" },
  { amount: "₹49,000", ad: "Reel – Story 02" },
  { amount: "₹4,999", ad: "Static – Broad" },
];

function TileMatched() {
  return (
    <Tile>
      <div className="absolute inset-0 flex flex-col justify-center gap-3.5 px-5">
        {MATCHES.map(({ amount, ad }) => (
          <div key={ad} className="flex items-center gap-2.5">
            <span className="w-18 shrink-0 rounded-md bg-white/10 px-2 py-1.5 text-right font-mono text-[10px] text-slate-300">
              {amount}
            </span>
            <span className="h-px flex-1 bg-white/15" />
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/20">
              <Check size={9} className="text-emerald-400" strokeWidth={3} />
            </span>
            <span className="h-px flex-1 bg-white/15" />
            <span className="shrink-0 rounded-md bg-white/10 px-2 py-1.5 text-[10px] text-slate-400">
              {ad}
            </span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

/*
 * Flagship: ads ranked by L2 revenue. The whole pitch in one glance —
 * the winner has the HIGHEST CPA, the cheapest-CPA ad made ₹0.
 */
const WINNERS = [
  { name: "Webinar – Hook A", cpa: "CPA ₹96", l2: "₹3.2L", bar: "w-[72%]", win: true },
  { name: "Reel – Story 02", cpa: "CPA ₹71", l2: "₹1.1L", bar: "w-[38%]", win: false },
  { name: "Static – Broad", cpa: "CPA ₹52", l2: "₹40k", bar: "w-[16%]", win: false },
  { name: "Reel – Discount", cpa: "CPA ₹34", l2: "₹0", bar: "w-[3%]", win: false },
];

function TileWinners() {
  return (
    <Tile tall>
      <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6 sm:px-8">
        <div className="flex items-center justify-between text-[10px] tracking-wider text-slate-500 uppercase">
          <span>Ad · CPA</span>
          <span>L2 revenue</span>
        </div>
        {WINNERS.map(({ name, cpa, l2, bar, win }) => (
          <div key={name} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-[11px] text-slate-300">
              {name}{" "}
              <span
                className={win ? "text-emerald-400/90" : "text-slate-500"}
              >
                · {cpa}
              </span>
            </span>
            <span className="flex-1">
              <span
                className={`block h-4 rounded-sm ${bar} ${
                  win ? "bg-emerald-400/70" : "bg-white/12"
                }`}
              />
            </span>
            <span
              className={`w-12 shrink-0 text-right font-mono text-[11px] ${
                win
                  ? "text-emerald-300"
                  : l2 === "₹0"
                    ? "text-red-400/90"
                    : "text-slate-400"
              }`}
            >
              {l2}
            </span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* Funnel drop-off: the leak step is marked, labeled, and quantified. */
const FUNNEL = [
  { label: "Visit", h: "h-24", drop: false },
  { label: "Form", h: "h-16", drop: false },
  { label: "Pay", h: "h-7", drop: true },
  { label: "L2", h: "h-5", drop: false },
];

function TileFunnel() {
  return (
    <Tile>
      <div className="absolute inset-0 flex items-end justify-center gap-6 px-8 pb-6">
        {FUNNEL.map(({ label, h, drop }) => (
          <div
            key={label}
            className="flex w-12 flex-col items-center gap-1.5"
          >
            {drop && (
              <span className="rounded-full bg-red-400/15 px-1.5 py-0.5 font-mono text-[10px] text-red-400">
                −71%
              </span>
            )}
            <span
              className={`w-full rounded-t-md ${h} ${
                drop ? "bg-red-400/50" : "bg-white/12"
              }`}
            />
            <span className="text-[10px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* We do the wiring: the setup checklist, already done. */
const WIRING = [
  "Landing pages — connected",
  "Payment gateway — connected",
  "Ads — mapped to sales",
];

function TileWiring() {
  return (
    <Tile>
      <div className="absolute inset-0 flex flex-col justify-center gap-4 px-6">
        {WIRING.map((label) => (
          <div key={label} className="flex items-center gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20">
              <Check size={11} className="text-emerald-400" strokeWidth={3} />
            </span>
            <span className="text-[11px] text-slate-400">{label}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

function FeatureCard({
  span,
  tile,
  title,
  children,
}: {
  span: string;
  tile: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`group flex flex-col gap-5 rounded-2xl border border-(--lp-line) bg-white/70 p-5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 sm:p-6 ${span}`}
    >
      {tile}
      <div>
        <h3 className="lp-display text-lg font-semibold tracking-tight text-(--lp-ink) sm:text-xl">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-(--lp-body)">
          {children}
        </p>
      </div>
    </article>
  );
}

export function Features() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-32">
      <h2 className="lp-display mx-auto max-w-2xl text-center text-3xl font-bold tracking-tight text-balance text-(--lp-ink) sm:text-5xl">
        What you&rsquo;ll see in week one
      </h2>

      <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-6">
        <FeatureCard
          span="lg:col-span-2"
          tile={<TileMatched />}
          title="Every sale, matched to its ad"
        >
          Each payment is matched to the exact ad, ad set, and campaign that
          caused it. Not modeled.{" "}
          <span className="font-semibold text-(--lp-positive)">Matched.</span>
        </FeatureCard>

        <FeatureCard
          span="lg:col-span-4"
          tile={<TileWinners />}
          title="Winners ranked by L2 revenue"
        >
          Your top ads ranked by the program revenue they actually produced —
          not clicks, not{" "}
          <span className="font-semibold text-(--lp-negative)">
            cheap leads
          </span>
          , not Meta&rsquo;s &ldquo;results&rdquo;.
        </FeatureCard>

        <FeatureCard
          span="lg:col-span-3"
          tile={<TileFunnel />}
          title="See where buyers drop"
        >
          Follow every visitor from page load to payment. Find the exact step
          where people leave — and fix it.
        </FeatureCard>

        <FeatureCard
          span="lg:col-span-3"
          tile={<TileWiring />}
          title="We do the wiring"
        >
          Trace goes into your funnel and your payment gateway, set up by us.
          No pixels to debug. You just open the dashboard.
        </FeatureCard>
      </div>
    </section>
  );
}

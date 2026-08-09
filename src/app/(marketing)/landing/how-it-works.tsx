import type * as React from "react";
import { Check } from "lucide-react";
import { RequestAccessButton } from "./cta-button";
import { SLOTS_LEFT_THIS_MONTH } from "./config";

/*
 * Section 7 — How it works (copy locked; no time/waiting language).
 * Step tiles are coded micro-illustrations in the same language as the
 * features bento (candidates to replace [how-img-1..3] entirely).
 */

function StepTile({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="relative h-40 overflow-hidden rounded-xl border border-white/10 bg-linear-to-br from-slate-950 via-slate-900 to-slate-950"
    >
      {children}
    </div>
  );
}

/* [how-img-1] request access: the slot, claimed */
function TileRequest() {
  return (
    <StepTile>
      <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6">
        <div className="flex items-center justify-between">
          <span className="h-2 w-24 rounded-full bg-white/12" />
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-mono text-[10px] text-amber-300">
            {SLOTS_LEFT_THIS_MONTH} slots left
          </span>
        </div>
        <div className="h-8 rounded-lg border border-white/10 bg-white/5" />
        <div className="flex h-8 items-center justify-center rounded-lg bg-white/90">
          <span className="text-[11px] font-semibold text-slate-900">
            Request Access
          </span>
        </div>
      </div>
    </StepTile>
  );
}

/* [how-img-2] we wire it in: our task list vs yours */
function TileWireIn() {
  return (
    <StepTile>
      <div className="absolute inset-0 flex items-center gap-4 px-6">
        <div className="flex-1 space-y-2.5">
          <p className="text-[10px] tracking-wider text-slate-500 uppercase">
            Us
          </p>
          {["w-full", "w-4/5", "w-full"].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Check size={10} className="shrink-0 text-emerald-400" strokeWidth={3} />
              <span className={`h-1.5 rounded-full bg-white/12 ${w}`} />
            </div>
          ))}
        </div>
        <div className="flex-1">
          <p className="text-[10px] tracking-wider text-slate-500 uppercase">
            You
          </p>
          <div className="mt-2.5 flex h-16 items-center justify-center rounded-lg border border-dashed border-white/15">
            <span className="text-[10px] text-slate-500">nothing to do</span>
          </div>
        </div>
      </div>
    </StepTile>
  );
}

/* [how-img-3] watch the money trail: click → L1 → L2 */
function TileTrail() {
  return (
    <StepTile>
      <div className="absolute inset-0 flex items-center justify-center gap-2 px-4">
        <span className="rounded-md bg-white/10 px-2 py-1.5 text-[10px] text-slate-400">
          Ad click
        </span>
        <span className="h-px w-4 bg-white/20" />
        <span className="rounded-md bg-white/10 px-2 py-1.5 font-mono text-[10px] text-slate-300">
          L1 ₹4,999
        </span>
        <span className="h-px w-4 bg-white/20" />
        <span className="rounded-md bg-emerald-400/15 px-2 py-1.5 font-mono text-[10px] text-emerald-300">
          L2 ₹49,000
        </span>
      </div>
    </StepTile>
  );
}

const STEPS: {
  tile: React.ReactNode;
  title: string;
  body: string;
}[] = [
  {
    tile: <TileRequest />,
    title: "Request access",
    body: `We onboard 4 clients a month. If there's a slot, we get on a call and map your funnel.`,
  },
  {
    tile: <TileWireIn />,
    title: "We wire it in",
    body: "Trace goes into your landing pages and your payment gateway. Zero effort on your end — you don't touch a thing.",
  },
  {
    tile: <TileTrail />,
    title: "Watch the money trail",
    body: "From the first click, every lead and payment flows in with the ad it came from. Winners rise to the top. Scale them, kill the rest.",
  },
];

export function HowItWorks() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-32">
      <h2 className="lp-display text-center text-3xl font-bold tracking-tight text-(--lp-ink) sm:text-5xl">
        How it works
      </h2>

      <ol className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {STEPS.map(({ tile, title, body }, i) => (
          <li
            key={title}
            className="flex flex-col gap-5 rounded-2xl border border-(--lp-line) bg-white/70 p-5 backdrop-blur-sm sm:p-6"
          >
            {tile}
            <div>
              <h3 className="lp-display text-lg font-semibold tracking-tight text-(--lp-ink)">
                <span className="mr-2 font-mono text-sm text-(--lp-faint)">
                  {i + 1}
                </span>
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-(--lp-body)">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12 flex justify-center">
        <RequestAccessButton />
      </div>
    </section>
  );
}

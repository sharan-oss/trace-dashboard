import type * as React from "react";

/*
 * Section 5 — "What you'll see in week one" (copy locked in spec).
 * Asymmetric bento: block 2 (Winners ranked by L2 revenue) is the flagship.
 * Each card's dark tile is a designed skeleton placeholder until the Gemini
 * image round ([feature-img-1..4]).
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

/* [feature-img-1] payment ↔ ad match */
function TileMatched() {
  return (
    <Tile>
      <div className="absolute inset-0 flex flex-col justify-center gap-4 px-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="h-6 w-16 rounded-md bg-white/10" />
            <span className="h-px flex-1 bg-white/15" />
            <span
              className={`size-2 rounded-full ${i === 1 ? "bg-emerald-400/80" : "bg-white/25"}`}
            />
            <span className="h-px flex-1 bg-white/15" />
            <span className="h-6 w-20 rounded-md bg-white/10" />
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* [feature-img-2] ads ranked by L2 revenue — flagship */
function TileWinners() {
  const widths = ["w-[85%]", "w-[62%]", "w-[38%]", "w-[22%]"];
  return (
    <Tile tall>
      <div className="absolute inset-0 flex flex-col justify-center gap-4 px-8">
        {widths.map((w, i) => (
          <div key={w} className="flex items-center gap-3">
            <span className="size-7 shrink-0 rounded-md bg-white/10" />
            <span
              className={`h-5 rounded-sm ${w} ${
                i === 0 ? "bg-emerald-400/70" : "bg-white/12"
              }`}
            />
          </div>
        ))}
      </div>
    </Tile>
  );
}

/* [feature-img-3] funnel drop-off */
function TileFunnel() {
  const heights = ["h-24", "h-16", "h-10", "h-6"];
  return (
    <Tile>
      <div className="absolute inset-0 flex items-end justify-center gap-5 px-8 pb-8">
        {heights.map((h, i) => (
          <span
            key={h}
            className={`w-12 rounded-t-md ${h} ${
              i === heights.length - 1 ? "bg-red-400/50" : "bg-white/12"
            }`}
          />
        ))}
      </div>
    </Tile>
  );
}

/* [feature-img-4] we do the wiring */
function TileWiring() {
  return (
    <Tile>
      <div className="absolute inset-0 flex flex-col justify-center gap-4 px-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex size-5 items-center justify-center rounded-full bg-emerald-400/20">
              <span className="size-1.5 rounded-full bg-emerald-400/80" />
            </span>
            <span
              className={`h-2 rounded-full bg-white/12 ${
                ["w-3/4", "w-1/2", "w-2/3"][i]
              }`}
            />
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

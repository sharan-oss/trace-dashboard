import type { Metadata } from "next";
import type * as React from "react";
import { RequestAccessButton } from "./cta-button";
import { CONTACT_EMAIL } from "./config";
import { Features } from "./features";
import { FinalCta } from "./final-cta";
import { HowItWorks } from "./how-it-works";
import { ScrollGrow } from "./scroll-grow";
import { TESTIMONIAL_SLOTS, TestimonialEditorial } from "./testimonial";

export const metadata: Metadata = {
  title: "Trace — Optimize your ad account for L2 conversions",
  description:
    "Trace follows every lead from ad click to L1 to L2 sale, so you double down on the ads that bring real L2 buyers. Built for coaches and course creators.",
};

/* Placeholder until Sharan supplies real client face photos (spec: hero
 * avatar strip). Tinted circles only — no fake faces, no fake initials. */
const AVATAR_TINTS = [
  "bg-amber-200",
  "bg-slate-300",
  "bg-amber-100",
  "bg-stone-300",
  "bg-blue-200",
];

function Rise({
  delay,
  children,
  className,
}: {
  delay: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`lp-rise ${className ?? ""}`}
      style={{ "--lp-rise-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden">
      {/* Hero backdrop: corner washes under dots+grid, bright center spotlight on top */}
      <div aria-hidden className="lp-hero-wash absolute inset-0" />
      <div aria-hidden className="lp-hero-pattern absolute inset-0" />
      <div aria-hidden className="lp-hero-spotlight absolute inset-0" />

      {/* Slim header */}
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <span className="lp-display text-xl font-bold tracking-tight text-(--lp-ink)">
          Trace
        </span>
        {/* TODO: point at the request-access flow once its destination is decided */}
        <a
          href="#request-access"
          className="rounded-full border border-(--lp-line) bg-white/60 px-4 py-2 text-sm font-medium text-(--lp-ink) backdrop-blur-sm transition-colors hover:border-(--lp-tint-line) hover:bg-(--lp-tint)"
        >
          Request Access
        </a>
      </header>

      {/* Hero */}
      <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-16 pb-24 text-center sm:pt-24 sm:pb-32">
        <Rise delay={0}>
          <h1 className="lp-display text-4xl leading-[1.05] font-bold tracking-tight text-balance text-(--lp-ink) sm:text-6xl lg:text-7xl">
            Optimize your ad account for{" "}
            <span className="text-(--lp-positive)">L2 conversions</span> — not{" "}
            <span className="text-(--lp-negative)">cheap leads</span>.
          </h1>
        </Rise>

        <Rise delay={120}>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-(--lp-body) sm:text-lg">
            Right now, your budget goes to whichever ad has the lowest CPA —
            even when none of those leads buy your program. Trace follows every
            lead from ad click{" "}
            <span className="whitespace-nowrap">→ L1 → L2 sale</span>, so you
            double down on the ads that bring real L2 buyers.
          </p>
        </Rise>

        <Rise delay={240} className="mt-10 flex flex-col items-center gap-3">
          <RequestAccessButton />
          <p className="text-sm text-(--lp-muted)">Zero setup on your side</p>
        </Rise>

        <Rise delay={360} className="mt-12 flex items-center gap-4">
          <div className="flex -space-x-2.5">
            {AVATAR_TINTS.map((tint) => (
              <span
                key={tint}
                className={`size-9 rounded-full ring-2 ring-(--lp-canvas) ${tint}`}
              />
            ))}
          </div>
          <p className="text-left text-sm text-(--lp-muted)">
            Loved by{" "}
            <span className="font-semibold text-(--lp-ink)">25+ coaches</span>{" "}
            &amp; course creators
          </p>
        </Rise>
      </section>

      {/* Testimonial slot 1 — proves the promise (Style A, locked 2026-08-10) */}
      <section className="relative mx-auto w-full max-w-5xl px-6 pb-24">
        <TestimonialEditorial {...TESTIMONIAL_SLOTS.provesThePromise} />
      </section>

      {/* Dashboard image — grows 80% → 100% width on scroll. Placeholder
          frame until the Gemini image round. */}
      <section className="relative mx-auto w-full max-w-6xl px-6 pb-32">
        <ScrollGrow>
          <div className="relative flex aspect-video items-center justify-center border border-white/10 bg-linear-to-br from-slate-950 via-slate-900 to-slate-950">
            {/* Faint skeleton hints so the frame reads as a product shot */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 flex items-center gap-1.5 border-b border-white/10 px-5 py-3.5"
            >
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
            </div>
            <div
              aria-hidden
              className="absolute top-12 bottom-6 left-5 hidden w-36 rounded-xl border border-white/10 bg-white/5 sm:block"
            />
            <p className="relative max-w-xs text-center text-sm text-slate-500">
              Dashboard preview — Gemini-generated image lands here
            </p>
          </div>
        </ScrollGrow>
      </section>

      {/* Section 5 — Top 4 features (bento) */}
      <Features />

      {/* Testimonial slot 2 — kills the setup objection */}
      <section className="relative mx-auto w-full max-w-5xl px-6 pb-32">
        <TestimonialEditorial {...TESTIMONIAL_SLOTS.killsSetupObjection} />
      </section>

      {/* Section 7 — How it works */}
      <HowItWorks />

      {/* Testimonial slot 3 — the after-state */}
      <section className="relative mx-auto w-full max-w-5xl px-6 pb-32">
        <TestimonialEditorial {...TESTIMONIAL_SLOTS.afterState} />
      </section>

      {/* Section 9 — Final CTA (dark band, anchor target) */}
      <FinalCta />

      {/* Footer — minimal */}
      <footer className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-4 border-t border-(--lp-line) px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <span className="lp-display block text-lg font-bold tracking-tight text-(--lp-ink)">
            Trace
          </span>
          <span className="text-sm text-(--lp-muted)">
            Payment-level ad attribution for course businesses
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <a
            href="#request-access"
            className="font-medium text-(--lp-ink) hover:underline"
          >
            Request Access
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-(--lp-muted) hover:text-(--lp-ink)"
          >
            {CONTACT_EMAIL}
          </a>
          <span className="text-(--lp-faint)">© 2026 Trace</span>
        </div>
      </footer>
    </main>
  );
}

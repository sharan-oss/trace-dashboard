import { RequestAccessButton } from "./cta-button";
import { SLOTS_LEFT_THIS_MONTH } from "./config";

/*
 * Section 9 — Final CTA (copy locked). The page's one dark band: the
 * inverse of the hero. Anchor target for every Request Access button.
 */
export function FinalCta() {
  return (
    <section id="request-access" className="relative mx-auto w-full max-w-6xl scroll-mt-8 px-6 pb-24">
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-16 text-center sm:px-12 sm:py-20">
        {/* Faint dot texture, echoing the hero */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgb(255 255 255 / 10%) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            maskImage:
              "radial-gradient(ellipse 70% 80% at 50% 0%, black, transparent)",
          }}
        />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center">
          <h2 className="lp-display text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">
            Every month, your budget buys more{" "}
            <span className="text-red-400">cheap leads</span> that never
            convert.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            30 days from now you could know exactly which ads bring{" "}
            <span className="font-semibold text-emerald-300">L2 buyers</span> —
            or still be scaling on CPA.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <RequestAccessButton onDark />
            <p className="text-sm text-amber-300/90">
              Only {SLOTS_LEFT_THIS_MONTH} slots left this month
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Star } from "lucide-react";

/* Placeholder testimonial content — REPLACE with a real client quote before
 * launch (spec slot 1: proves the hero's promise, contains a ₹/% number).
 * Never ship the placeholder. */
const PLACEHOLDER = {
  quote:
    "Real client quote lands here — a specific decision made from Trace data, with the number that proves it.",
  name: "Client Name",
  business: "Course Business",
};

function Stars({ className }: { className?: string }) {
  return (
    <div className={`flex gap-1 ${className ?? ""}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={16} className="fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

/** Style A — editorial pull-quote: no card, the words carry it. */
export function TestimonialEditorial() {
  return (
    <figure className="mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
      <Stars />
      <blockquote className="lp-display mt-5 text-2xl leading-snug font-medium tracking-tight text-balance text-(--lp-ink) sm:text-3xl">
        &ldquo;{PLACEHOLDER.quote}&rdquo;
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3">
        <span className="size-10 rounded-full bg-amber-200 ring-2 ring-(--lp-canvas)" />
        <span className="text-left text-sm">
          <span className="block font-semibold text-(--lp-ink)">
            {PLACEHOLDER.name}
          </span>
          <span className="text-(--lp-muted)">{PLACEHOLDER.business}</span>
        </span>
      </figcaption>
    </figure>
  );
}

/** Style B — quiet card: white surface, left-aligned, more conventional. */
export function TestimonialCard() {
  return (
    <figure className="mx-auto max-w-2xl rounded-2xl border border-(--lp-line) bg-white/80 p-8 backdrop-blur-sm sm:p-10">
      <Stars />
      <blockquote className="mt-5 text-lg leading-relaxed text-(--lp-body)">
        &ldquo;{PLACEHOLDER.quote}&rdquo;
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3 border-t border-(--lp-line) pt-6">
        <span className="size-10 rounded-full bg-amber-200" />
        <span className="text-sm">
          <span className="block font-semibold text-(--lp-ink)">
            {PLACEHOLDER.name}
          </span>
          <span className="text-(--lp-muted)">{PLACEHOLDER.business}</span>
        </span>
      </figcaption>
    </figure>
  );
}

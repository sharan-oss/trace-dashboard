import { Star } from "lucide-react";

/*
 * Testimonial slots (Style A — editorial pull-quote, locked 2026-08-10).
 * PLACEHOLDER CONTENT — replace each slot with a real client quote before
 * launch. Slot jobs (spec): 1 proves the promise with a number, 2 kills the
 * setup objection, 3 shows the after-state. Never ship placeholders.
 */
export const TESTIMONIAL_SLOTS = {
  provesThePromise: {
    quote:
      "Real client quote lands here — a specific decision made from Trace data, with the number that proves it.",
    name: "Client Name",
    business: "Course Business",
  },
  killsSetupObjection: {
    quote:
      "Real client quote lands here — how little they had to do; setup that took none of their time.",
    name: "Client Name",
    business: "Course Business",
  },
  afterState: {
    quote:
      "Real client quote lands here — what changed once they knew their winners, month over month.",
    name: "Client Name",
    business: "Course Business",
  },
} as const;

function Stars({ className }: { className?: string }) {
  return (
    <div className={`flex gap-1 ${className ?? ""}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={16} className="fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

export function TestimonialEditorial({
  quote,
  name,
  business,
}: {
  quote: string;
  name: string;
  business: string;
}) {
  return (
    <figure className="mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
      <Stars />
      <blockquote className="lp-display mt-5 text-2xl leading-snug font-medium tracking-tight text-balance text-(--lp-ink) sm:text-3xl">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3">
        <span className="size-10 rounded-full bg-amber-200 ring-2 ring-(--lp-canvas)" />
        <span className="text-left text-sm">
          <span className="block font-semibold text-(--lp-ink)">{name}</span>
          <span className="text-(--lp-muted)">{business}</span>
        </span>
      </figcaption>
    </figure>
  );
}

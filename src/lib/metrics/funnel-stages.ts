/**
 * The funnel's stage order, defined once.
 *
 * The event stream is an ORDERED sequence (page_load → … → payment_complete)
 * and v_funnel_by_session encodes "reached this stage or any later one", so
 * counts are monotonically non-increasing along this array. Components and
 * tests both import it; nobody re-derives stage order or labels ad hoc.
 */

export type StageKey =
  | "reached_page_load"
  | "reached_form_open"
  | "reached_form_start"
  | "reached_form_submit"
  | "reached_payment_open"
  | "reached_payment_complete";

export type FunnelStage = {
  key: StageKey;
  label: string;
  /** Short phrase for the biggest-leak callout: "…never {lossVerb}". */
  lossVerb: string;
};

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  { key: "reached_page_load", label: "Page view", lossVerb: "load the page" },
  { key: "reached_form_open", label: "Form opened", lossVerb: "open the form" },
  { key: "reached_form_start", label: "Form started", lossVerb: "start filling the form" },
  { key: "reached_form_submit", label: "Form submitted", lossVerb: "submit the form" },
  { key: "reached_payment_open", label: "Payment opened", lossVerb: "open the payment" },
  { key: "reached_payment_complete", label: "Paid", lossVerb: "complete the payment" },
] as const;

export type StageCounts = Record<StageKey, number>;

export type BiggestLeak = {
  /** Stage people were at. */
  fromLabel: string;
  /** The stage they failed to reach — its lossVerb feeds the sentence. */
  lossVerb: string;
  /** Share of fromStage's people lost before the next stage, 0..1. */
  lostShare: number;
};

/**
 * The largest relative drop between ADJACENT stages, page-load onward.
 * Sessions that never loaded are deliberately outside this: they are dead
 * traffic (the wasted-clicks strip), not a step a visitor abandoned. Null when
 * nothing loaded or nothing drops.
 */
export function biggestLeak(counts: StageCounts): BiggestLeak | null {
  let best: BiggestLeak | null = null;
  for (let i = 1; i < FUNNEL_STAGES.length; i += 1) {
    const from = counts[FUNNEL_STAGES[i - 1].key];
    const to = counts[FUNNEL_STAGES[i].key];
    if (from <= 0) continue;
    const lostShare = (from - to) / from;
    if (best == null || lostShare > best.lostShare) {
      best = {
        fromLabel: FUNNEL_STAGES[i - 1].label,
        lossVerb: FUNNEL_STAGES[i].lossVerb,
        lostShare,
      };
    }
  }
  return best != null && best.lostShare > 0 ? best : null;
}

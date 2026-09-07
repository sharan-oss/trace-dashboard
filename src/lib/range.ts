/**
 * Date-range state for the dashboard.
 *
 * The L1 window travels as `?range=7d|30d|all` (a preset) or
 * `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`. Presets keep sending a day
 * count to the RPCs, where null means "all time" — that is the path every
 * client without a split window takes, and it is byte-for-byte the behaviour
 * that shipped before custom windows existed.
 *
 * Overview and Ads additionally accept an optional L2 window
 * (`&l2from=…&l2to=…`), which re-scopes upsell revenue to payments made inside
 * it BY customers acquired inside the L1 window. Webinar funnels need this:
 * ads run 1-15, the webinar sells on 15-16. Customers and Funnel do not use it
 * and keep calling parseRangeParam directly.
 */

export type RangePreset = "7d" | "30d" | "all";

export const DEFAULT_RANGE: RangePreset = "30d";

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

const VALID: ReadonlySet<string> = new Set(["7d", "30d", "all"]);

export function parseRangeParam(
  value: string | string[] | undefined,
): RangePreset {
  const first = Array.isArray(value) ? value[0] : value;
  return first != null && VALID.has(first)
    ? (first as RangePreset)
    : DEFAULT_RANGE;
}

export function rangeToDays(preset: RangePreset): number | null {
  switch (preset) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "all":
      return null;
  }
}

/** Inclusive IST day window, both bounds YYYY-MM-DD. */
export type DateWindow = { from: string; to: string };

export type RangeSelection =
  | { kind: "preset"; preset: RangePreset }
  | { kind: "custom"; from: string; to: string };

export type RangeState = {
  /** Scopes spend, sessions and L1 payments — and, in split mode, who counts as acquired. */
  l1: RangeSelection;
  /** Null = no split; L2 is scoped by the L1 window exactly as before. */
  l2: DateWindow | null;
};

export const DEFAULT_RANGE_STATE: RangeState = {
  l1: { kind: "preset", preset: DEFAULT_RANGE },
  l2: null,
};

/** Lifts a bare preset into a range state — for the sections that only ever
 * take a preset (Customers, Funnel) and share the same picker. */
export function presetState(preset: RangePreset): RangeState {
  return { l1: { kind: "preset", preset }, l2: null };
}

export type RangeSearchParams = {
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
  l2from?: string | string[];
  l2to?: string | string[];
  /** Overview's day drill-down (`?day=YYYY-MM-DD`). Not part of RangeState. */
  day?: string | string[];
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day, not merely a well-shaped string: Date.parse accepts
 * "2026-02-31" and silently rolls it into March, which would show a window the
 * user never asked for. Round-tripping catches that.
 */
function parseDay(value: string | undefined): string | null {
  if (value == null || !DAY_RE.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === value ? value : null;
}

/**
 * A single day from a search param — Overview's `?day=`. Deliberately the same
 * parseDay() the window bounds use, so "2026-02-31" is rejected rather than
 * rolled into March here too (reject-to-default, never repair).
 */
export function parseDayParam(
  value: string | string[] | undefined,
): string | null {
  return parseDay(first(value));
}

/** Both bounds present, real, and ordered — otherwise no window at all. */
function parseWindow(
  from: string | string[] | undefined,
  to: string | string[] | undefined,
): DateWindow | null {
  const f = parseDay(first(from));
  const t = parseDay(first(to));
  if (f == null || t == null || f > t) return null;
  return { from: f, to: t };
}

/**
 * Reject-to-default, never repair: a half-written or inverted window falls back
 * to the 30-day preset (or drops the split) rather than being silently clamped
 * or swapped. A window the user did not choose is worse than an obvious reset.
 */
export function parseRangeState(params: RangeSearchParams): RangeState {
  const l2 = parseWindow(params.l2from, params.l2to);
  if (first(params.range) === "custom") {
    const custom = parseWindow(params.from, params.to);
    if (custom != null) {
      return { l1: { kind: "custom", ...custom }, l2 };
    }
  }
  return { l1: { kind: "preset", preset: parseRangeParam(params.range) }, l2 };
}

/**
 * Query string for hrefs built from scratch (the Ads tabs and the campaign
 * drill-down), which would otherwise drop every param they don't name and
 * silently reset the window on navigation. No leading "?".
 */
export function serializeRangeState(state: RangeState): string {
  const params = new URLSearchParams();
  if (state.l1.kind === "custom") {
    params.set("range", "custom");
    params.set("from", state.l1.from);
    params.set("to", state.l1.to);
  } else {
    params.set("range", state.l1.preset);
  }
  if (state.l2 != null) {
    params.set("l2from", state.l2.from);
    params.set("l2to", state.l2.to);
  }
  return params.toString();
}

/** True when the L2 window is in play — the one flag the UI branches on. */
export function isSplitWindow(state: RangeState): boolean {
  return state.l2 != null;
}

export type RangeRpcArgs = {
  p_days: number | null;
  p_from: string | null;
  p_to: string | null;
};

export type RangeRpcArgsWithL2 = RangeRpcArgs & {
  p_l2_from: string | null;
  p_l2_to: string | null;
};

/**
 * L1-window args for the RPCs with no L2 arm (ads_summary,
 * overview_spend_daily). Presets send p_days with both dates null, which is
 * exactly the pre-custom-window call — the SQL takes the identical path.
 */
export function rangeRpcArgs(state: RangeState): RangeRpcArgs {
  return state.l1.kind === "custom"
    ? { p_days: null, p_from: state.l1.from, p_to: state.l1.to }
    : { p_days: rangeToDays(state.l1.preset), p_from: null, p_to: null };
}

/** Same, plus the optional L2 window, for the four L2-bearing RPCs. */
export function rangeRpcArgsWithL2(state: RangeState): RangeRpcArgsWithL2 {
  return {
    ...rangeRpcArgs(state),
    p_l2_from: state.l2?.from ?? null,
    p_l2_to: state.l2?.to ?? null,
  };
}

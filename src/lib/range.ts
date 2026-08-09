/**
 * Date-range presets for the dashboard. The preset travels as a URL search
 * param (`?range=7d|30d|all`); the RPC layer receives a day count, where
 * null means "all time" — the SQL functions read null as no cutoff.
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

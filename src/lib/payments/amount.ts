import { toMinorUnits } from "@/lib/meta/money";

/**
 * A typed rupee amount → integer paise, or null when it is not a valid
 * positive amount. String-based like toMinorUnits (no float), but stricter:
 * a third decimal is a typo to reject, not a value to truncate. Tolerates the
 * things people type into a money field — a ₹ sign, spaces, en-IN grouping
 * commas (GOV.UK: never error on a re-typed prefix).
 */
export function parseRupeesToPaise(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const paise = toMinorUnits(clean, "INR");
  return paise > 0 ? paise : null;
}

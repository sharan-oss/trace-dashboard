/**
 * Currency conversion for Meta's spend values.
 *
 * Meta returns spend as a decimal STRING in the ad account's currency. It is
 * converted by string manipulation, never parseFloat: binary floating point
 * cannot represent most decimal fractions exactly, and a cent lost per row
 * compounds across every ROAS figure in the product.
 *
 * Everything downstream stores integer minor units, matching payments.amount.
 */
const MINOR_UNIT_DIGITS: Record<string, number> = { INR: 2 };
const DEFAULT_MINOR_UNIT_DIGITS = 2;

export function toMinorUnits(decimal: string, currency: string): number {
  const trimmed = decimal?.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`toMinorUnits: not a decimal number: ${JSON.stringify(decimal)}`);
  }

  const digits = MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? DEFAULT_MINOR_UNIT_DIGITS;
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");

  // Truncate rather than round: Meta's own totals truncate, and rounding up
  // would let reported spend exceed what was actually charged.
  const scaled = `${whole}${fraction.padEnd(digits, "0").slice(0, digits)}`;
  const value = Number.parseInt(scaled, 10);
  return negative ? -value : value;
}

/**
 * Display formatting for the dashboard. All helpers are null-safe: null and
 * undefined render as an em dash ("—") so a placeholder metric can flow
 * straight into the UI, while real zeros stay visible as data.
 *
 * Money arrives as paise (smallest unit, per payments.amount) and renders as
 * whole rupees in en-IN lakh/crore grouping.
 */

const EM_DASH = "—";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
});

const count = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return EM_DASH;
  return inr.format(paise / 100);
}

export function formatINRCompact(paise: number | null | undefined): string {
  if (paise == null) return EM_DASH;
  return inrCompact.format(paise / 100);
}

export function formatPercent(
  ratio: number | null | undefined,
  digits = 1,
): string {
  if (ratio == null) return EM_DASH;
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return EM_DASH;
  return count.format(n);
}

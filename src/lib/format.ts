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

/**
 * An IST calendar day (YYYY-MM-DD, as the RPCs emit) rendered as "12 Jul".
 * Parsed as UTC deliberately: the string is already an IST calendar date, so
 * re-interpreting it in the viewer's zone would shift it by a day.
 */
export function formatDayShort(day: string | null | undefined): string {
  if (day == null) return EM_DASH;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return EM_DASH;
  return new Date(parsed).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

/**
 * An inclusive day window as "1 – 15 Aug", dropping the repeated month when
 * both ends share one, and collapsing to a single day when they are equal.
 */
export function formatDayRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const left = formatDayShort(from);
  const right = formatDayShort(to);
  if (left === EM_DASH || right === EM_DASH) return EM_DASH;
  if (left === right) return left;
  const leftMonth = left.slice(left.indexOf(" ") + 1);
  const rightMonth = right.slice(right.indexOf(" ") + 1);
  const leftText = leftMonth === rightMonth ? left.slice(0, left.indexOf(" ")) : left;
  return `${leftText} – ${right}`;
}

/** Days rendered for humans: "3.4 days", "1 day", em dash when unknown. */
export function formatDays(days: number | null | undefined): string {
  if (days == null) return EM_DASH;
  const rounded = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

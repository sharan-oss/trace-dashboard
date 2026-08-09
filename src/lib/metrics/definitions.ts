/**
 * The two conversion rates, named separately and deliberately.
 *
 * They answer different questions: sessions-to-paid measures the ad and the
 * landing page, attempts-to-paid measures the checkout. Publishing only one
 * would hide either ad quality or a payment gateway problem, so neither may
 * ever be labelled simply "conversion".
 */
export const CONVERSION_RATE_LABEL = "Conversion rate";
export const CHECKOUT_COMPLETION_LABEL = "Checkout completion";

/** Ratio in 0..1, or null when the denominator is zero — never NaN or Infinity. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** Paid payments divided by sessions. */
export function conversionRate(
  paidPayments: number,
  sessions: number
): number | null {
  return ratio(paidPayments, sessions);
}

/** Paid payments divided by all payment attempts. */
export function checkoutCompletion(
  paidPayments: number,
  paymentAttempts: number
): number | null {
  return ratio(paidPayments, paymentAttempts);
}

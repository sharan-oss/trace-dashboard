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

/**
 * The ad-economics ratios, decided 2026-08-10 (Slice D design doc): ROAS
 * credits the full customer value — L1 plus the L2 revenue already
 * acquisition-credited to the ad — while CPA is pure acquisition cost. The
 * labels carry the definition so neither can ever read as a plain "ROAS"/"CPA"
 * whose meaning drifts.
 */
export const META_SPEND_LABEL = "Meta spend";
export const ROAS_LABEL = "ROAS (L1+L2)";
export const CPA_LABEL = "CPA (L1)";

/** (L1+L2) revenue ÷ Meta spend, both in paise. Null when spend is zero. */
export function roas(totalRevenuePaise: number, spendPaise: number): number | null {
  return ratio(totalRevenuePaise, spendPaise);
}

/** Meta spend ÷ L1 paid count, in paise per buyer. Null when no buyers. */
export function cpa(spendPaise: number, l1PaidCount: number): number | null {
  return ratio(spendPaise, l1PaidCount);
}

/**
 * The Meta-native delivery ratios (2026-08-13 Ads restructure). Both divide
 * Meta's own synced counts — no attribution logic touches them, so they are
 * exact by construction and safe at any grouping level.
 */
export const CTR_LABEL = "CTR";
export const CPM_LABEL = "CPM";

/** Clicks ÷ impressions, in 0..1. Null when there are no impressions. */
export function ctr(clicks: number, impressions: number): number | null {
  return ratio(clicks, impressions);
}

/** Meta spend per 1,000 impressions, in paise. Null when there are no impressions. */
export function cpm(spendPaise: number, impressions: number): number | null {
  const perImpression = ratio(spendPaise, impressions);
  return perImpression === null ? null : perImpression * 1000;
}

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
 * The customer-economics ratios (2026-08-16, Customers Value tab). These answer
 * the owner's question — is the machine profitable — where roas/cpa answer the
 * media buyer's. All three are cohort metrics: they describe customers ACQUIRED
 * in the window, valued in full, against the spend that acquired them. Mixing
 * cohort value with activity-window spend is the classic way LTV:CAC lies, so
 * the RPCs enforce the cohort and these stay pure arithmetic.
 */
export const CAC_LABEL = "CAC";
export const LTV_CAC_LABEL = "LTV:CAC";
export const REPEAT_RATE_LABEL = "Repeat rate";
export const AVG_LTV_LABEL = "Avg LTV";

/**
 * Meta spend ÷ customers acquired, in paise per customer.
 *
 * Null when there are no customers AND null when there is no spend. The second
 * guard is the one that matters: a client with no Meta account connected has
 * zero spend, and ratio() would happily return 0 — rendering "CAC ₹0", which
 * reads as "these customers were free" when the truth is "we have no
 * acquisition cost data at all". Caught on Occultyogis during verification,
 * 2026-08-16. Absent data must say n/a, never zero.
 */
export function cac(spendPaise: number, customers: number): number | null {
  if (spendPaise <= 0) return null;
  return ratio(spendPaise, customers);
}

/** Average lifetime value in paise across the cohort. Null when the cohort is empty. */
export function avgLtv(
  cohortLifetimePaise: number,
  customers: number
): number | null {
  return ratio(cohortLifetimePaise, customers);
}

/**
 * Cohort lifetime value ÷ what it cost to acquire it. Unitless, so paise cancel
 * — but both arguments must be paise, and both must describe the SAME cohort.
 * Null when there was no spend, never Infinity.
 */
export function ltvCac(
  cohortLifetimePaise: number,
  spendPaise: number
): number | null {
  return ratio(cohortLifetimePaise, spendPaise);
}

/** Customers who bought more than once ÷ all customers, in 0..1. */
export function repeatRate(
  repeatCustomers: number,
  customers: number
): number | null {
  return ratio(repeatCustomers, customers);
}

/**
 * Below this many customers a rate is noise, not a measurement: 14 repeat
 * buyers spread across 10 ads makes every per-ad repeat rate meaningless.
 * Callers render sub-threshold ratios muted rather than asserting them. The
 * counts themselves are always shown — those are facts at any n.
 */
export const MIN_DENOMINATOR_FOR_RATE = 20;

export function isRateReadable(denominator: number): boolean {
  return denominator >= MIN_DENOMINATOR_FOR_RATE;
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

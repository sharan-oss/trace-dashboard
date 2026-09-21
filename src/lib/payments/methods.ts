/**
 * How off-platform money actually moves for an Indian coaching business.
 * Slugs are stored in external_payments.raw_payload->>'method' and rendered
 * through paymentOrigin(); they share Razorpay's vocabulary (upi, card,
 * netbanking…) so reconciliation against a gateway export stays literal.
 * Kept as a fixed list rather than free text: the label ladder in
 * payment-origin.ts and the SQL check in record_manual_payment both key on it.
 */
export const PAYMENT_METHODS = [
  { slug: "gpay", label: "GPay", referenceHint: "12-digit UTR / UPI transaction ID" },
  { slug: "phonepe", label: "PhonePe", referenceHint: "12-digit UTR / UPI transaction ID" },
  { slug: "upi", label: "UPI (other app)", referenceHint: "12-digit UTR / UPI transaction ID" },
  { slug: "bank_transfer", label: "Bank transfer", referenceHint: "UTR or bank reference no." },
  { slug: "cash", label: "Cash", referenceHint: "Optional — receipt no. if you gave one" },
  { slug: "cheque", label: "Cheque", referenceHint: "Cheque number" },
  { slug: "other", label: "Other", referenceHint: "Optional" },
] as const;

export type PaymentMethodSlug = (typeof PAYMENT_METHODS)[number]["slug"];

export const METHOD_SLUGS = PAYMENT_METHODS.map((m) => m.slug) as [
  PaymentMethodSlug,
  ...PaymentMethodSlug[],
];

export function referenceHintFor(slug: string): string {
  return PAYMENT_METHODS.find((m) => m.slug === slug)?.referenceHint ?? "Optional";
}

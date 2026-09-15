/**
 * One story for "how did this money arrive?", shared by the Overview day
 * drill-down and the customer sheet so the same row can never be described
 * two ways (before 2026-09-15 a hand-recorded GPay upsell read "Recorded by
 * hand" in one and "Payment link" in the other).
 *
 * `method` is `external_payments.raw_payload->>'method'` — for synced rows the
 * gateway's own slug (upi, card…), for hand-entered rows what the admin typed
 * (gpay). Only hand-entered rows surface it: a synced row's "payment link" IS
 * its provenance, while a manual row's provenance is "someone recorded it",
 * which only makes sense next to how the money actually moved.
 */

const METHOD_NAMES: Record<string, string> = {
  gpay: "GPay",
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  bank_transfer: "Bank transfer",
  cash: "Cash",
};

function methodName(method: string): string {
  const known = METHOD_NAMES[method.toLowerCase()];
  if (known != null) return known;
  const words = method.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type PaymentOriginInput = {
  /** False for a Trace checkout payment, true for an external_payments row. */
  external: boolean;
  /** payments.gateway or external_payments.source. */
  source: string;
  method: string | null | undefined;
};

export type PaymentOrigin = {
  /** Short chip text. */
  label: string;
  /** Hover explanation. */
  title: string;
};

export function paymentOrigin(input: PaymentOriginInput): PaymentOrigin {
  if (!input.external) {
    return { label: "Trace checkout", title: "Paid through Trace's checkout" };
  }
  switch (input.source) {
    case "manual": {
      const method = input.method?.trim();
      if (!method) {
        return {
          label: "Recorded by hand",
          title: "Paid off-platform and entered by hand by an admin",
        };
      }
      const name = methodName(method);
      return {
        label: `${name} · recorded by hand`,
        title: `Paid via ${name} directly to the coach, off-platform; entered by hand by an admin`,
      };
    }
    case "tagmango":
      return {
        label: "TagMango",
        title:
          "Paid through TagMango, matched to this person by email or phone",
      };
    default:
      return {
        label: "Payment link",
        title:
          "Paid outside Trace's checkout (e.g. a payment link), matched to this person by email or phone",
      };
  }
}

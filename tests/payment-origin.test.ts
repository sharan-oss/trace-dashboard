import { describe, expect, it } from "vitest";
import { paymentOrigin } from "@/lib/payment-origin";

// Pure tests — no DB. Every case names the wrong label it catches.

describe("paymentOrigin", () => {
  it("labels a Trace checkout row regardless of gateway", () => {
    expect(
      paymentOrigin({ external: false, source: "razorpay", method: "upi" })
        .label,
    ).toBe("Trace checkout");
  });

  it("names the method on a hand-recorded row", () => {
    // Catches: the pre-2026-09-15 UI, which said "Recorded by hand" in the
    // day drill-down and "Payment link" in the customer sheet for the same
    // GPay row — neither said how the money actually moved.
    const o = paymentOrigin({
      external: true,
      source: "manual",
      method: "gpay",
    });
    expect(o.label).toBe("GPay · recorded by hand");
    expect(o.title).toContain("GPay");
    expect(o.title).toContain("by hand");
  });

  it("falls back to plain 'Recorded by hand' when a manual row has no method", () => {
    // Catches: "null · recorded by hand" / "undefined · recorded by hand".
    expect(
      paymentOrigin({ external: true, source: "manual", method: null }).label,
    ).toBe("Recorded by hand");
    expect(
      paymentOrigin({ external: true, source: "manual", method: "" }).label,
    ).toBe("Recorded by hand");
  });

  it("humanises a method it has no display name for", () => {
    // Catches: showing the raw slug "bank_transfer".
    expect(
      paymentOrigin({
        external: true,
        source: "manual",
        method: "bank_transfer",
      }).label,
    ).toBe("Bank transfer · recorded by hand");
  });

  it("keeps synced rows as 'Payment link' — their method is not a provenance story", () => {
    // A Razorpay UPI payment through a link is still "a payment link" to the
    // coach; only hand-entered rows need the method to explain themselves.
    expect(
      paymentOrigin({ external: true, source: "razorpay", method: "upi" })
        .label,
    ).toBe("Payment link");
  });

  it("labels TagMango by name", () => {
    expect(
      paymentOrigin({ external: true, source: "tagmango", method: null }).label,
    ).toBe("TagMango");
  });
});

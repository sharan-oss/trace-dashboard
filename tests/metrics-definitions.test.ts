import { describe, expect, it } from "vitest";
import {
  CHECKOUT_COMPLETION_LABEL,
  CONVERSION_RATE_LABEL,
  checkoutCompletion,
  conversionRate,
} from "@/lib/metrics/definitions";

describe("metric labels (AC-3)", () => {
  it("names the two metrics distinctly and never as bare 'conversion'", () => {
    expect(CONVERSION_RATE_LABEL).toBe("Conversion rate");
    expect(CHECKOUT_COMPLETION_LABEL).toBe("Checkout completion");
    expect(CONVERSION_RATE_LABEL).not.toBe(CHECKOUT_COMPLETION_LABEL);
    for (const label of [CONVERSION_RATE_LABEL, CHECKOUT_COMPLETION_LABEL]) {
      expect(label.toLowerCase()).not.toBe("conversion");
    }
  });
});

describe("conversionRate — paid payments over sessions", () => {
  it("computes the ratio", () => {
    expect(conversionRate(467, 8238)).toBeCloseTo(0.0567, 4);
  });

  it("returns null rather than Infinity or NaN when there are no sessions", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(5, 0)).toBeNull();
  });

  it("returns 0 when there are sessions but no paid payments", () => {
    expect(conversionRate(0, 100)).toBe(0);
  });
});

describe("checkoutCompletion — paid payments over all attempts", () => {
  it("computes the ratio", () => {
    expect(checkoutCompletion(467, 716)).toBeCloseTo(0.6522, 4);
  });

  it("differs from conversionRate on the same paid count", () => {
    expect(checkoutCompletion(467, 716)).not.toBe(conversionRate(467, 8238));
  });

  it("returns null rather than Infinity or NaN when there are no attempts", () => {
    expect(checkoutCompletion(0, 0)).toBeNull();
  });
});

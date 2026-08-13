import { describe, expect, it } from "vitest";
import {
  CHECKOUT_COMPLETION_LABEL,
  CONVERSION_RATE_LABEL,
  CPM_LABEL,
  CTR_LABEL,
  checkoutCompletion,
  conversionRate,
  cpa,
  cpm,
  ctr,
  roas,
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

  it("returns null rather than a negative ratio when the denominator is negative", () => {
    // The `ratio()` guard is `denominator <= 0`; a session count can never
    // legitimately be negative, but this confirms the guard covers the whole
    // non-positive range, not just the exact-zero case above.
    expect(conversionRate(5, -10)).toBeNull();
  });
});

describe("checkoutCompletion — paid payments over all attempts", () => {
  it("computes the ratio", () => {
    expect(checkoutCompletion(467, 716)).toBeCloseTo(0.6522, 4);
  });

  it("returns null rather than Infinity or NaN when there are no attempts", () => {
    expect(checkoutCompletion(0, 0)).toBeNull();
  });
});

describe("ctr/cpm — Meta-native delivery ratios (2026-08-13 Ads restructure)", () => {
  it("ctr divides clicks by impressions", () => {
    // Live Love School all-time at build date: 17,185 clicks / 1,642,898 impressions.
    expect(ctr(17185, 1642898)).toBeCloseTo(0.01046, 5);
  });

  it("cpm is spend per thousand impressions, in paise", () => {
    // ₹100.00 (10000 paise) over 5,000 impressions = ₹20.00 CPM (2000 paise).
    expect(cpm(10000, 5000)).toBe(2000);
  });

  it("both return null rather than Infinity or NaN with zero impressions", () => {
    expect(ctr(0, 0)).toBeNull();
    expect(ctr(5, 0)).toBeNull();
    expect(cpm(10000, 0)).toBeNull();
  });

  it("labels exist and are distinct", () => {
    expect(CTR_LABEL).toBe("CTR");
    expect(CPM_LABEL).toBe("CPM");
  });
});

describe("roas/cpa — null-on-zero-denominator contract", () => {
  it("roas is null with zero spend, cpa is null with zero buyers", () => {
    expect(roas(5000, 0)).toBeNull();
    expect(cpa(0, 0)).toBeNull();
    expect(roas(30000, 10000)).toBe(3);
    expect(cpa(10000, 4)).toBe(2500);
  });
});

describe("checkoutCompletion is its own metric, not conversionRate under another name (AC-3)", () => {
  it("is a distinct function from conversionRate", () => {
    // Both metrics are, mechanically, the same division — that is exactly
    // why an *output* comparison can never prove they are separately
    // implemented: for any shared (numerator, denominator) pair, a correct
    // independent implementation and a straight alias
    // (`export const checkoutCompletion = conversionRate`) return the exact
    // same number, because a÷b is a÷b no matter which function computed it.
    // A prior version of this test compared checkoutCompletion(467, 716)
    // against conversionRate(467, 8238) — different arguments on each side —
    // so it "passed" even under the alias, since different inputs produce
    // different outputs regardless of which function ran. The only thing
    // that actually distinguishes "two metrics" from "one metric with two
    // names" is that they are not the same function reference.
    expect(checkoutCompletion).not.toBe(conversionRate);
  });
});

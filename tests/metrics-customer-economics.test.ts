/**
 * The customer-economics ratios. Pure arithmetic, no database.
 *
 * The theme of every case here is the difference between "zero" and "unknown".
 * A dashboard that renders absent data as 0 does not merely look wrong, it
 * asserts something false — "these customers cost nothing" — and on a page whose
 * whole job is deciding whether to spend more, that is the most expensive
 * mistake it could make.
 */
import { describe, expect, it } from "vitest";
import {
  avgLtv,
  cac,
  isRateReadable,
  ltvCac,
  repeatRate,
  MIN_DENOMINATOR_FOR_RATE,
} from "@/lib/metrics/definitions";

describe("cac", () => {
  it("divides spend by customers acquired", () => {
    expect(cac(60_207_413, 548)).toBeCloseTo(109_867.5, 0);
  });

  it("is null when there are no customers, never Infinity", () => {
    expect(cac(50_000, 0)).toBeNull();
  });

  it("is null when there is no spend, never zero", () => {
    // The Occultyogis case: customers exist, no Meta account is connected. A
    // CAC of Rs 0 would claim they were acquired for free.
    expect(cac(0, 598)).toBeNull();
  });
});

describe("ltvCac", () => {
  it("is unitless — paise cancel", () => {
    expect(ltvCac(15_190_100, 60_207_413)).toBeCloseTo(0.2523, 3);
  });

  it("is null without spend, never Infinity", () => {
    expect(ltvCac(15_190_100, 0)).toBeNull();
  });

  it("reports a genuinely worthless cohort as 0, not null", () => {
    // Spend happened and bought nothing. That is a finding, not missing data,
    // and the two must not render the same way.
    expect(ltvCac(0, 500_000)).toBe(0);
  });
});

describe("avgLtv", () => {
  it("averages cohort value across the cohort", () => {
    expect(avgLtv(15_190_100, 548)).toBeCloseTo(27_719.2, 0);
  });

  it("is null for an empty cohort", () => {
    expect(avgLtv(0, 0)).toBeNull();
  });
});

describe("repeatRate", () => {
  it("returns a 0..1 ratio", () => {
    expect(repeatRate(14, 548)).toBeCloseTo(0.02554, 4);
  });

  it("is null for an empty cohort, and 0 for a cohort where nobody returned", () => {
    expect(repeatRate(0, 0)).toBeNull();
    expect(repeatRate(0, 100)).toBe(0);
  });
});

describe("isRateReadable", () => {
  it("rejects denominators too small for a rate to mean anything", () => {
    // 14 repeat buyers across 10 ads is the live case: every per-ad rate would
    // be noise presented as a measurement.
    expect(isRateReadable(1)).toBe(false);
    expect(isRateReadable(MIN_DENOMINATOR_FOR_RATE - 1)).toBe(false);
    expect(isRateReadable(MIN_DENOMINATOR_FOR_RATE)).toBe(true);
    expect(isRateReadable(548)).toBe(true);
  });
});

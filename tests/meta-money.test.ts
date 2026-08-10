import { describe, expect, it } from "vitest";
import { toMinorUnits } from "@/lib/meta/money";

describe("toMinorUnits", () => {
  it("converts a two-decimal string to paise", () => {
    expect(toMinorUnits("123.45", "INR")).toBe(12345);
  });

  it("converts a whole number with no decimal point", () => {
    expect(toMinorUnits("500", "INR")).toBe(50000);
  });

  it("pads a single decimal place", () => {
    expect(toMinorUnits("12.5", "INR")).toBe(1250);
  });

  it("handles zero", () => {
    expect(toMinorUnits("0", "INR")).toBe(0);
    expect(toMinorUnits("0.00", "INR")).toBe(0);
  });

  it("does not lose precision on a value floats get wrong", () => {
    // 8.29 * 100 is 828.9999... in IEEE 754; a parseFloat implementation
    // rounds to 829 by luck here but fails on other values, so assert the
    // exact expected integer for several known-awkward inputs.
    expect(toMinorUnits("8.29", "INR")).toBe(829);
    expect(toMinorUnits("1.005", "INR")).toBe(100); // truncates beyond 2dp, never rounds up
    expect(toMinorUnits("19.99", "INR")).toBe(1999);
    expect(toMinorUnits("1234567.89", "INR")).toBe(123456789);
  });

  it("throws on a non-numeric value rather than silently returning 0", () => {
    expect(() => toMinorUnits("not a number", "INR")).toThrow();
    expect(() => toMinorUnits("", "INR")).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { parseRupeesToPaise } from "@/lib/payments/amount";

// Pure tests. Every case names the bug it catches.

describe("parseRupeesToPaise", () => {
  it("parses a plain rupee amount", () => {
    expect(parseRupeesToPaise("5000")).toBe(500000);
  });

  it("parses two decimals exactly — the real upsell price", () => {
    // Catches: Math.round(9724.20 * 100), which only works by luck of float
    // representation; string arithmetic is exact.
    expect(parseRupeesToPaise("9724.20")).toBe(972420);
    expect(parseRupeesToPaise("9724.2")).toBe(972420);
  });

  it("tolerates a re-typed rupee sign, spaces and en-IN grouping", () => {
    // GOV.UK: allow users to type the prefix; do not error on it.
    expect(parseRupeesToPaise("₹ 9,724.20")).toBe(972420);
    expect(parseRupeesToPaise(" 1,00,000 ")).toBe(10000000);
  });

  it("rejects more than two decimals rather than truncating", () => {
    // toMinorUnits truncates (right for Meta spend); a typed amount with a
    // third decimal is a typo, not a value to silently shave.
    expect(parseRupeesToPaise("9724.205")).toBeNull();
  });

  it("rejects zero, negatives, empty and non-numeric input", () => {
    expect(parseRupeesToPaise("0")).toBeNull();
    expect(parseRupeesToPaise("0.00")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("")).toBeNull();
    expect(parseRupeesToPaise("1e3")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise(".5")).toBeNull();
  });
});

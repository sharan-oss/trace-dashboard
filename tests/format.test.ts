import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatINR,
  formatINRCompact,
  formatPercent,
} from "@/lib/format";
import { parseRangeParam, rangeToDays } from "@/lib/range";

// Every case names the broken implementation it catches. Pure tests — no DB.

describe("formatINR", () => {
  it("formats paise as whole rupees with en-IN lakh/crore grouping", () => {
    // Catches: en-US grouping ("₹123,456") and forgetting the paise
    // division ("₹1,23,45,600").
    expect(formatINR(12345600)).toBe("₹1,23,456");
  });

  it("formats the real L1 headline figure", () => {
    expect(formatINR(6100700)).toBe("₹61,007");
  });

  it("renders zero as ₹0, not the null dash", () => {
    // Catches: a falsy check (`if (!paise)`) that turns a real ₹0 day
    // into "—".
    expect(formatINR(0)).toBe("₹0");
  });

  it("renders null and undefined as an em dash", () => {
    // Catches: "₹NaN" reaching the UI when a placeholder metric is null.
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
  });

  it("rounds sub-rupee paise instead of showing decimals", () => {
    // 972420 paise = ₹9,724.20 — axis/tile values are whole rupees.
    expect(formatINR(972420)).toBe("₹9,724");
  });
});

describe("formatINRCompact", () => {
  it("compacts to the en-IN K/L/Cr scale", () => {
    // Catches: western M/B compacting and missing paise division.
    // Pinned to verified Node ICU output for en-IN.
    expect(formatINRCompact(4900000)).toBe("₹49K");
    expect(formatINRCompact(97242000)).toBe("₹9.7L");
  });

  it("keeps small values plain", () => {
    expect(formatINRCompact(15000)).toBe("₹150");
  });

  it("renders null as an em dash", () => {
    expect(formatINRCompact(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats a 0..1 ratio as a percentage", () => {
    // Catches: missing ×100 ("0.1%" for a 5.37% rate) and wrong rounding.
    expect(formatPercent(0.0537)).toBe("5.4%");
  });

  it("renders a real zero rate as 0.0%, not the null dash", () => {
    // Catches: the falsy-zero trap — 0 conversions is data, not absence.
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("renders null as an em dash", () => {
    // conversionRate() returns null on a zero denominator; that contract
    // flows straight through here. Catches "NaN%" in the UI.
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });

  it("respects the digits argument", () => {
    expect(formatPercent(0.0537, 2)).toBe("5.37%");
  });
});

describe("formatCount", () => {
  it("groups integers en-IN style", () => {
    // Catches: en-US grouping on large counts ("1,234,567").
    expect(formatCount(12557)).toBe("12,557");
    expect(formatCount(1234567)).toBe("12,34,567");
  });

  it("renders zero as 0 and null as an em dash", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("—");
  });
});

describe("parseRangeParam", () => {
  it("passes through valid presets", () => {
    expect(parseRangeParam("7d")).toBe("7d");
    expect(parseRangeParam("30d")).toBe("30d");
    expect(parseRangeParam("all")).toBe("all");
  });

  it("defaults junk and absence to 30d", () => {
    // Catches: defaulting to 7d (wrong default) or throwing on a
    // hand-edited URL.
    expect(parseRangeParam("junk")).toBe("30d");
    expect(parseRangeParam(undefined)).toBe("30d");
    expect(parseRangeParam("")).toBe("30d");
  });

  it("takes the first value of a repeated search param", () => {
    expect(parseRangeParam(["7d", "all"])).toBe("7d");
  });
});

describe("rangeToDays", () => {
  it("maps presets to day windows, with all-time as null", () => {
    // Catches: "all" treated as 0 days, which would render an empty
    // dashboard — the RPCs read null as no cutoff.
    expect(rangeToDays("7d")).toBe(7);
    expect(rangeToDays("30d")).toBe(30);
    expect(rangeToDays("all")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  parseRangeState,
  rangeRpcArgs,
  rangeRpcArgsWithL2,
  serializeRangeState,
  type RangeState,
} from "@/lib/range";
import { formatDayRange } from "@/lib/format";
import { chartSpan } from "@/lib/queries/overview";

/**
 * Pure unit tests for the range state layer. The load-bearing property is the
 * first one: every URL that worked before custom windows existed must still
 * parse to the same preset, and a preset must still send p_days alone — that
 * is what keeps the default SQL path byte-for-byte identical.
 */

describe("parseRangeState — back-compatibility with bare presets", () => {
  it("parses the three presets exactly as before", () => {
    for (const preset of ["7d", "30d", "all"] as const) {
      expect(parseRangeState({ range: preset })).toEqual({
        l1: { kind: "preset", preset },
        l2: null,
      });
    }
  });

  it("falls back to 30d for absent, junk, or unknown values", () => {
    for (const range of [undefined, "", "nonsense", "custom"]) {
      expect(parseRangeState({ range })).toEqual({
        l1: { kind: "preset", preset: "30d" },
        l2: null,
      });
    }
  });

  it("takes the first value when a param repeats", () => {
    expect(parseRangeState({ range: ["7d", "all"] }).l1).toEqual({
      kind: "preset",
      preset: "7d",
    });
  });
});

describe("parseRangeState — custom L1 window", () => {
  it("accepts a valid ordered pair", () => {
    expect(
      parseRangeState({ range: "custom", from: "2026-08-01", to: "2026-08-15" }),
    ).toEqual({
      l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" },
      l2: null,
    });
  });

  it("accepts a single-day window", () => {
    const state = parseRangeState({
      range: "custom",
      from: "2026-08-15",
      to: "2026-08-15",
    });
    expect(state.l1).toEqual({ kind: "custom", from: "2026-08-15", to: "2026-08-15" });
  });

  it("rejects to the default rather than repairing bad input", () => {
    const bad = [
      { from: "2026-08-15", to: undefined },
      { from: undefined, to: "2026-08-15" },
      // Inverted: swapping it would show a window nobody asked for.
      { from: "2026-08-15", to: "2026-08-01" },
      { from: "15-08-2026", to: "16-08-2026" },
      // Date.parse rolls this into 3 March; the round-trip check catches it.
      { from: "2026-02-31", to: "2026-03-05" },
      { from: "2026-08-01", to: "not-a-date" },
    ];
    for (const params of bad) {
      expect(parseRangeState({ range: "custom", ...params }).l1).toEqual({
        kind: "preset",
        preset: "30d",
      });
    }
  });
});

describe("parseRangeState — optional L2 window", () => {
  const l2 = { l2from: "2026-08-15", l2to: "2026-08-16" };

  it("activates only when both bounds are present, real and ordered", () => {
    expect(parseRangeState({ range: "30d", ...l2 }).l2).toEqual({
      from: "2026-08-15",
      to: "2026-08-16",
    });
    for (const partial of [
      { l2from: "2026-08-15" },
      { l2to: "2026-08-16" },
      { l2from: "2026-08-16", l2to: "2026-08-15" },
      { l2from: "2026-13-01", l2to: "2026-13-02" },
    ]) {
      expect(parseRangeState({ range: "30d", ...partial }).l2).toBeNull();
    }
  });

  it("composes with a preset L1 and with a custom L1 alike", () => {
    expect(parseRangeState({ range: "7d", ...l2 })).toEqual({
      l1: { kind: "preset", preset: "7d" },
      l2: { from: "2026-08-15", to: "2026-08-16" },
    });
    expect(
      parseRangeState({ range: "custom", from: "2026-08-01", to: "2026-08-15", ...l2 }),
    ).toEqual({
      l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" },
      l2: { from: "2026-08-15", to: "2026-08-16" },
    });
  });

  it("survives an invalid L1 window — the split is independent", () => {
    const state = parseRangeState({ range: "custom", from: "bad", ...l2 });
    expect(state.l1).toEqual({ kind: "preset", preset: "30d" });
    expect(state.l2).toEqual({ from: "2026-08-15", to: "2026-08-16" });
  });
});

describe("serializeRangeState", () => {
  const cases: RangeState[] = [
    { l1: { kind: "preset", preset: "7d" }, l2: null },
    { l1: { kind: "preset", preset: "all" }, l2: { from: "2026-08-15", to: "2026-08-16" } },
    { l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" }, l2: null },
    {
      l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" },
      l2: { from: "2026-08-15", to: "2026-08-16" },
    },
  ];

  it("round-trips through parseRangeState", () => {
    for (const state of cases) {
      const params = Object.fromEntries(
        new URLSearchParams(serializeRangeState(state)).entries(),
      );
      expect(parseRangeState(params)).toEqual(state);
    }
  });

  it("emits no L2 keys when there is no split", () => {
    expect(serializeRangeState(cases[0])).toBe("range=7d");
  });
});

describe("rangeRpcArgs — the byte-for-byte guarantee", () => {
  it("sends p_days alone for a preset, so the SQL takes the pre-existing path", () => {
    expect(rangeRpcArgs({ l1: { kind: "preset", preset: "30d" }, l2: null })).toEqual({
      p_days: 30,
      p_from: null,
      p_to: null,
    });
    expect(rangeRpcArgs({ l1: { kind: "preset", preset: "7d" }, l2: null }).p_days).toBe(7);
    // All time stays null — no cutoff, exactly as before.
    expect(rangeRpcArgs({ l1: { kind: "preset", preset: "all" }, l2: null }).p_days).toBeNull();
  });

  it("sends explicit dates and no day count for a custom window", () => {
    expect(
      rangeRpcArgs({
        l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" },
        l2: null,
      }),
    ).toEqual({ p_days: null, p_from: "2026-08-01", p_to: "2026-08-15" });
  });

  it("passes the L2 window only when split, null otherwise", () => {
    expect(
      rangeRpcArgsWithL2({ l1: { kind: "preset", preset: "30d" }, l2: null }),
    ).toEqual({ p_days: 30, p_from: null, p_to: null, p_l2_from: null, p_l2_to: null });

    expect(
      rangeRpcArgsWithL2({
        l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" },
        l2: { from: "2026-08-15", to: "2026-08-16" },
      }),
    ).toEqual({
      p_days: null,
      p_from: "2026-08-01",
      p_to: "2026-08-15",
      p_l2_from: "2026-08-15",
      p_l2_to: "2026-08-16",
    });
  });
});

describe("chartSpan", () => {
  const today = "2026-08-16";

  it("mirrors the SQL cutoff for a preset", () => {
    expect(chartSpan({ l1: { kind: "preset", preset: "7d" }, l2: null }, today)).toEqual({
      from: "2026-08-10",
      to: today,
    });
  });

  it("returns a null start for all time so the caller falls back to the data", () => {
    expect(chartSpan({ l1: { kind: "preset", preset: "all" }, l2: null }, today).from).toBeNull();
  });

  it("covers the union of both windows in split mode", () => {
    // The webinar sells after the ad window closes; without the union those
    // L2 days would fall off the right edge of the chart.
    expect(
      chartSpan(
        {
          l1: { kind: "custom", from: "2026-08-01", to: "2026-08-15" },
          l2: { from: "2026-08-15", to: "2026-08-18" },
        },
        today,
      ),
    ).toEqual({ from: "2026-08-01", to: "2026-08-18" });

    // And an L2 window that opens before the ad window widens the left edge.
    expect(
      chartSpan(
        {
          l1: { kind: "custom", from: "2026-08-10", to: "2026-08-15" },
          l2: { from: "2026-08-05", to: "2026-08-12" },
        },
        today,
      ),
    ).toEqual({ from: "2026-08-05", to: "2026-08-15" });
  });
});

describe("formatDayRange", () => {
  it("drops the repeated month and collapses a single day", () => {
    expect(formatDayRange("2026-08-01", "2026-08-15")).toBe("1 – 15 Aug");
    expect(formatDayRange("2026-08-15", "2026-08-15")).toBe("15 Aug");
    expect(formatDayRange("2026-07-28", "2026-08-02")).toBe("28 Jul – 2 Aug");
  });

  it("renders an em dash when either bound is missing or unparseable", () => {
    expect(formatDayRange(null, "2026-08-15")).toBe("—");
    expect(formatDayRange("2026-08-15", undefined)).toBe("—");
    expect(formatDayRange("nope", "2026-08-15")).toBe("—");
  });
});

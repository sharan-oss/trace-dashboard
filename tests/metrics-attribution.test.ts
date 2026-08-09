import { describe, expect, it } from "vitest";
import {
  UNATTRIBUTED_LABEL,
  groupWithUnattributed,
  tierKeyOf,
} from "@/lib/metrics/attribution";

type Row = {
  ad_key: string | null;
  adset_key: string | null;
  campaign_key: string | null;
  revenue: number;
};

const row = (
  ad: string | null,
  adset: string | null,
  campaign: string | null,
  revenue: number
): Row => ({ ad_key: ad, adset_key: adset, campaign_key: campaign, revenue });

// Two rows on one ad, one row resolving only an ad set, one only a campaign,
// one resolving nothing at all, a second ad sharing that first ad's ad set
// and campaign, and a second campaign with its own ad set and ad. This gives
// every tier at least two distinct attributed keys with clearly different
// totals, so sort-order assertions below actually exercise a comparison
// instead of running over a single-element list.
const rows: Row[] = [
  row("120242114093820519", "120237239322730519", "120235128175530519", 9900),
  row("120242114093820519", "120237239322730519", "120235128175530519", 9900),
  row(null, "120237239322730519", "120235128175530519", 4900),
  row(null, null, "120235128175530519", 9900),
  row(null, null, null, 100),
  // Second ad, same ad set and campaign as the first: gives the "ad" tier a
  // second, larger key so descending order is a real comparison.
  row("120242114093820600", "120237239322730519", "120235128175530519", 30000),
  // Second campaign, with its own ad set and ad: gives the "adset" and
  // "campaign" tiers a second distinct key each.
  row("120242114093820700", "120237239322730700", "120235128175530700", 500),
];

const byRevenue = (r: Row) => r.revenue;
const total = rows.reduce((sum, r) => sum + r.revenue, 0);

describe("groupWithUnattributed (AC-5, AC-20)", () => {
  it("reconciles at every tier: grouped rows plus Unattributed equal the total", () => {
    for (const tier of ["ad", "adset", "campaign"] as const) {
      const groups = groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue);
      expect(groups.reduce((sum, g) => sum + g.value, 0), `tier ${tier}`).toBe(total);
    }
  });

  it("emits exactly one explicit Unattributed row at every tier", () => {
    for (const tier of ["ad", "adset", "campaign"] as const) {
      const groups = groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue);
      const unattributed = groups.filter((g) => g.isUnattributed);
      expect(unattributed, `tier ${tier}`).toHaveLength(1);
      expect(unattributed[0].label).toBe(UNATTRIBUTED_LABEL);
      expect(unattributed[0].key).toBeNull();
    }
  });

  it("counts an ad-set-only row as attributed at ad set level and Unattributed at ad level", () => {
    const adGroups = groupWithUnattributed(rows, tierKeyOf<Row>("ad"), byRevenue);
    const adsetGroups = groupWithUnattributed(rows, tierKeyOf<Row>("adset"), byRevenue);

    // 4900 (ad-set-only) + 9900 (campaign-only) + 100 (nothing) at ad level
    expect(adGroups.find((g) => g.isUnattributed)?.value).toBe(14900);
    // at ad set level the 4900 joins the real ad set group, along with the
    // second ad (30000) which shares that same ad set
    expect(adsetGroups.find((g) => g.key === "120237239322730519")?.value).toBe(54700);
    expect(adsetGroups.find((g) => g.isUnattributed)?.value).toBe(10000);
  });

  it("narrows the Unattributed bucket as the tier gets less specific", () => {
    const values = (["ad", "adset", "campaign"] as const).map(
      (tier) =>
        groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue).find((g) => g.isUnattributed)!
          .value
    );
    expect(values[0]).toBeGreaterThan(values[1]);
    expect(values[1]).toBeGreaterThan(values[2]);
    expect(values[2]).toBe(100);
  });

  it("sums rows sharing a key", () => {
    const groups = groupWithUnattributed(rows, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups.find((g) => g.key === "120242114093820519")?.value).toBe(19800);
  });

  it("still emits an Unattributed row when nothing is unattributed, so totals line up", () => {
    const allAttributed = [row("120111222333", "120444555666", "120777888999", 100)];
    const groups = groupWithUnattributed(allAttributed, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups.filter((g) => g.isUnattributed)).toHaveLength(1);
    expect(groups.find((g) => g.isUnattributed)?.value).toBe(0);
  });

  it("treats empty and whitespace-only keys as unattributed", () => {
    const messy = [row("", null, null, 10), row("   ", null, null, 20), row(null, null, null, 30)];
    const groups = groupWithUnattributed(messy, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups).toHaveLength(1);
    expect(groups[0].isUnattributed).toBe(true);
    expect(groups[0].value).toBe(60);
  });

  it("sorts attributed groups by descending value, keeping Unattributed last, at every tier", () => {
    for (const tier of ["ad", "adset", "campaign"] as const) {
      const groups = groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue);
      expect(groups[groups.length - 1].isUnattributed, `tier ${tier}`).toBe(true);

      const attributed = groups.filter((g) => !g.isUnattributed);
      // The fixture is built so every tier has at least two distinct
      // attributed keys with different totals — otherwise the comparison
      // loop below runs zero times and the test proves nothing.
      expect(attributed.length, `tier ${tier}`).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < attributed.length; i++) {
        expect(
          attributed[i - 1].value,
          `tier ${tier}, position ${i}`
        ).toBeGreaterThanOrEqual(attributed[i].value);
      }
    }
  });

  it("keeps Unattributed last even when it is the largest group — not merely sorted by value", () => {
    // If the Unattributed group were folded into a plain value-sort instead
    // of being force-appended last, this fixture would put it first, since
    // its total dwarfs the one attributed group.
    const heavilyUnattributed: Row[] = [
      row("120111222333", "120444555666", "120777888999", 100),
      row(null, null, null, 1_000_000),
    ];
    const groups = groupWithUnattributed(heavilyUnattributed, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups[groups.length - 1].isUnattributed).toBe(true);
    expect(groups[groups.length - 1].value).toBe(1_000_000);
    expect(groups[groups.length - 1].value).toBeGreaterThan(groups[0].value);
  });

  it("returns only the zero Unattributed row for empty input", () => {
    const groups = groupWithUnattributed([] as Row[], tierKeyOf<Row>("ad"), byRevenue);
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe(0);
  });

  it("treats an undefined key the same as a null key, for callers passing a raw lambda instead of tierKeyOf", () => {
    // tierKeyOf always normalizes a missing key to `null` via `?? null`, so
    // it never actually exercises the `undefined` branch of keyOf's return
    // type. A caller building its own accessor (e.g. `(row) => row.someOptionalField`)
    // can genuinely produce `undefined`, and the falsy check must catch it too.
    type LooseRow = { key?: string | null; amount: number };
    const looseRows: LooseRow[] = [
      { key: "shared-key", amount: 10 },
      { key: undefined, amount: 5 },
      { amount: 7 }, // key entirely absent -> undefined
    ];
    const groups = groupWithUnattributed(
      looseRows,
      (r) => r.key,
      (r) => r.amount
    );
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key === "shared-key")?.value).toBe(10);
    expect(groups.find((g) => g.isUnattributed)?.value).toBe(12);
  });
});

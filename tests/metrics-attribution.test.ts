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
// and one resolving nothing at all.
const rows: Row[] = [
  row("120242114093820519", "120237239322730519", "120235128175530519", 9900),
  row("120242114093820519", "120237239322730519", "120235128175530519", 9900),
  row(null, "120237239322730519", "120235128175530519", 4900),
  row(null, null, "120235128175530519", 9900),
  row(null, null, null, 100),
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
    // at ad set level the 4900 joins the real ad set group
    expect(adsetGroups.find((g) => g.key === "120237239322730519")?.value).toBe(24700);
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

  it("sorts attributed groups by descending value, keeping Unattributed last", () => {
    const groups = groupWithUnattributed(rows, tierKeyOf<Row>("campaign"), byRevenue);
    expect(groups[groups.length - 1].isUnattributed).toBe(true);
    const attributed = groups.filter((g) => !g.isUnattributed);
    for (let i = 1; i < attributed.length; i++) {
      expect(attributed[i - 1].value).toBeGreaterThanOrEqual(attributed[i].value);
    }
  });

  it("returns only the zero Unattributed row for empty input", () => {
    const groups = groupWithUnattributed([] as Row[], tierKeyOf<Row>("ad"), byRevenue);
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe(0);
  });
});

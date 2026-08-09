/**
 * Grouping helpers that guarantee a breakdown reconciles to its real total.
 *
 * Rows resolving no key at the requested tier are collected into one explicit
 * Unattributed group rather than filtered out, and that group is emitted even
 * when empty, so every breakdown satisfies:
 *   grouped rows + Unattributed = ungrouped total.
 *
 * Attribution runs in three tiers. A row that resolved an ad set but no ad is
 * attributed at ad set level and Unattributed at ad level — both are true at
 * once, and both must hold. Selecting the tier through tierKeyOf keeps that
 * property in one place instead of scattered across call sites.
 */
export const UNATTRIBUTED_LABEL = "Unattributed";

export type AttributionTier = "ad" | "adset" | "campaign";

export type TierKeys = {
  ad_key?: string | null;
  adset_key?: string | null;
  campaign_key?: string | null;
};

export type AttributedGroup = {
  key: string | null;
  label: string;
  value: number;
  isUnattributed: boolean;
};

const TIER_COLUMN: Record<AttributionTier, keyof TierKeys> = {
  ad: "ad_key",
  adset: "adset_key",
  campaign: "campaign_key",
};

/** Key accessor for one attribution tier, for passing to groupWithUnattributed. */
export function tierKeyOf<T extends TierKeys>(
  tier: AttributionTier
): (row: T) => string | null {
  const column = TIER_COLUMN[tier];
  return (row) => row[column] ?? null;
}

export function groupWithUnattributed<T>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined,
  valueOf: (row: T) => number
): AttributedGroup[] {
  const attributed = new Map<string, number>();
  let unattributed = 0;

  for (const row of rows) {
    const key = keyOf(row)?.trim();
    const value = valueOf(row);
    if (!key) {
      unattributed += value;
      continue;
    }
    attributed.set(key, (attributed.get(key) ?? 0) + value);
  }

  const groups: AttributedGroup[] = [...attributed.entries()]
    .map(([key, value]) => ({ key, label: key, value, isUnattributed: false }))
    .sort((a, b) => b.value - a.value);

  groups.push({
    key: null,
    label: UNATTRIBUTED_LABEL,
    value: unattributed,
    isUnattributed: true,
  });

  return groups;
}

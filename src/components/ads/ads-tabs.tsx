import { LinkTabs } from "@/components/navigation/link-tabs";

export type AdsTab = "campaigns" | "ads";

/**
 * The Ads section's two sub-views — Campaigns | Ads, Meta Ads Manager's own
 * names. Links, so tab state lives in the URL (?tab=) and stays shareable;
 * switching back to Campaigns deliberately drops any ?campaign= filter, which
 * only means something inside the Ads view.
 *
 * `rangeQuery` is the serialized window (serializeRangeState) rather than a
 * bare preset: these hrefs are built from scratch, so anything not named here
 * — a custom window, a separate L2 window — would be silently reset on a tab
 * switch.
 */
export function AdsTabs({
  active,
  rangeQuery,
}: {
  active: AdsTab;
  rangeQuery: string;
}) {
  return (
    <LinkTabs
      label="Ads section views"
      active={active}
      basePath="/ads"
      param="tab"
      defaultKey="campaigns"
      tabs={[
        { key: "campaigns", label: "Campaigns", href: `/ads?tab=campaigns&${rangeQuery}` },
        { key: "ads", label: "Ads", href: `/ads?tab=ads&${rangeQuery}` },
      ]}
    />
  );
}

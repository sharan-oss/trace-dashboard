import { LinkTabs } from "@/components/navigation/link-tabs";
import type { RangePreset } from "@/lib/range";

export type CustomersTab = "value" | "people";

/**
 * The Customers section's two sub-views. Value is the economics argument;
 * People is the individuals behind it. Links so tab state lives in the URL and
 * stays shareable — and switching tabs deliberately drops the People-only
 * params (search, sort, page, open customer), which mean nothing on the other
 * side.
 */
export function CustomersTabs({
  active,
  range,
}: {
  active: CustomersTab;
  range: RangePreset;
}) {
  return (
    <LinkTabs
      label="Customers section views"
      active={active}
      basePath="/customers"
      param="tab"
      defaultKey="value"
      tabs={[
        { key: "value", label: "Value", href: `/customers?tab=value&range=${range}` },
        { key: "people", label: "People", href: `/customers?tab=people&range=${range}` },
      ]}
    />
  );
}

import { describe, expect, it } from "vitest";
import { adsManagerUrl } from "@/lib/meta/ads-manager";

describe("adsManagerUrl", () => {
  it("strips the act_ prefix Ads Manager does not want", () => {
    const url = adsManagerUrl("act_1468167101279643", "120246763826240519");
    expect(url).toContain("act=1468167101279643");
    expect(url).not.toContain("act=act_");
    expect(url).toContain("selected_ad_ids=120246763826240519");
  });

  it("returns null rather than a broken link when either id is missing", () => {
    expect(adsManagerUrl(null, "123")).toBeNull();
    expect(adsManagerUrl("act_1", null)).toBeNull();
    expect(adsManagerUrl("", "123")).toBeNull();
  });
});

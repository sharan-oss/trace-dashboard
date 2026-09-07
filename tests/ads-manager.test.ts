import { describe, expect, it } from "vitest";
import { adsManagerUrl, makeAdAccountResolver } from "@/lib/meta/ads-manager";

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
    // A campaign id does not rescue a missing account or ad.
    expect(adsManagerUrl(null, "123", "999")).toBeNull();
    expect(adsManagerUrl("act_1", null, "999")).toBeNull();
  });

  it("scopes to the campaign so the ad is not lost in the account's ad list", () => {
    // The whole point: selected_ad_ids alone resolves against every ad on the
    // account (~1,200 for Love School). The campaign filter is what makes the
    // link land on one ad.
    const url = adsManagerUrl(
      "act_1052790390047154",
      "120247294371040519",
      "120247294371080519",
    );
    expect(url).toContain("selected_campaign_ids=120247294371080519");
    expect(url).toContain("selected_ad_ids=120247294371040519");
  });

  it("orders the campaign filter before the ad selection", () => {
    // Ads Manager reads the params as a drill path; the parent has to come
    // first. Asserted on position because URLSearchParams preserves set order.
    const url = adsManagerUrl("act_1", "222", "111")!;
    expect(url.indexOf("selected_campaign_ids")).toBeLessThan(
      url.indexOf("selected_ad_ids"),
    );
  });

  it("omits the campaign param entirely when unknown, rather than sending it empty", () => {
    // Degrades to the old account-wide link instead of breaking outright.
    for (const campaign of [null, undefined, ""]) {
      const url = adsManagerUrl("act_1", "222", campaign)!;
      expect(url).not.toContain("selected_campaign_ids");
      expect(url).toContain("selected_ad_ids=222");
    }
  });

  it("targets the ads tab on the Ads Manager host", () => {
    // Previously unasserted, so a typo in either would have shipped silently.
    const url = adsManagerUrl("act_1", "222", "111")!;
    expect(url.startsWith(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?",
    )).toBe(true);
  });
});

describe("makeAdAccountResolver", () => {
  const ALTTRED = { id: "acc-uuid-1", meta_ad_account_id: "act_1052790390047154" };
  const V2 = { id: "acc-uuid-2", meta_ad_account_id: "act_1312705356631852" };

  it("resolves each ad to the account that actually owns it", () => {
    // The bug this replaces: the Ads page linked all of Love School's 1,258
    // ads through the account owning 1,155 of them, so the other 103 named an
    // account that does not contain them — silently.
    const resolve = makeAdAccountResolver([ALTTRED, V2]);
    expect(resolve(ALTTRED.id)).toBe("act_1052790390047154");
    expect(resolve(V2.id)).toBe("act_1312705356631852");
  });

  it("refuses to guess when the client has several accounts", () => {
    // Null hides the link. A missing link is recoverable; a confidently wrong
    // one sends someone to an account that cannot contain the ad.
    const resolve = makeAdAccountResolver([ALTTRED, V2]);
    expect(resolve(null)).toBeNull();
    expect(resolve("not-an-account-of-this-client")).toBeNull();
  });

  it("falls back to the sole account, where a guess cannot be wrong", () => {
    const resolve = makeAdAccountResolver([ALTTRED]);
    expect(resolve(null)).toBe("act_1052790390047154");
    expect(resolve("unknown-uuid")).toBe("act_1052790390047154");
  });

  it("resolves to null for a client with no connected accounts", () => {
    const resolve = makeAdAccountResolver([]);
    expect(resolve(null)).toBeNull();
    expect(resolve("anything")).toBeNull();
  });

  it("builds the whole link for a real second-account ad", () => {
    // The exact production case that was broken: ad
    // "LS 01-ABO-BROAD-Copy of Madhu Love Coach 3-06-06-26" lives on Love
    // School's SECOND account, so the old accounts[0] link named
    // act=1052790390047154 — an account that does not contain it.
    const resolve = makeAdAccountResolver([ALTTRED, V2]);
    const url = adsManagerUrl(
      resolve(V2.id),
      "120246869906520005",
      "120246869906490005",
    );
    expect(url).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads" +
        "?act=1312705356631852" +
        "&selected_campaign_ids=120246869906490005" +
        "&selected_ad_ids=120246869906520005",
    );
  });
});

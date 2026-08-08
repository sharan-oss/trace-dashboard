import { describe, expect, it } from "vitest";
import { adminClient } from "./helpers/supabase";

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

const LOVE_SCHOOL_URL =
  "https://workshop.schooloflove.co.in/love-magnet-workshop/?Ad+ID=120242114093820519&Adset+content=LS+01";
const OCCULT_URL =
  "https://vastu.occultyogis.com/devurja-vastu-fb/?utm_source=fb&utm_id=120987654321&Ad_id=120246979966760";

describe("metric_ad_id_from_url", () => {
  it("extracts a plus-encoded 'Ad+ID' key (Love School's shape)", async () => {
    expect(await rpc("metric_ad_id_from_url", { url: LOVE_SCHOOL_URL })).toBe(
      "120242114093820519"
    );
  });

  it("extracts an 'Ad_id' key (Occultyogis' shape)", async () => {
    expect(await rpc("metric_ad_id_from_url", { url: OCCULT_URL })).toBe(
      "120246979966760"
    );
  });

  it("extracts an 'h_ad_id' key", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?h_ad_id=120111222333" })
    ).toBe("120111222333");
  });

  it("rejects an unexpanded {{ad.id}} macro", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad+ID=%7b%7bad.id%7d%7d" })
    ).toBeNull();
  });

  it("rejects literal null and _removed_ values", async () => {
    expect(await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad+ID=null" })).toBeNull();
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad+ID=_removed_" })
    ).toBeNull();
  });

  it("does not match fbclid (the LIKE underscore-wildcard trap)", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?fbclid=120999888777" })
    ).toBeNull();
  });

  it("returns null when no ad key is present", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?utm_source=fb" })
    ).toBeNull();
  });
});

describe("metric_ad_id_from_params", () => {
  it("reads a decoded 'Ad ID' key", async () => {
    expect(
      await rpc("metric_ad_id_from_params", { params: { "Ad ID": "120242114093820519" } })
    ).toBe("120242114093820519");
  });

  it("reads an 'h_ad_id' key and ignores fbc_id", async () => {
    expect(
      await rpc("metric_ad_id_from_params", {
        params: { fbc_id: "120555", h_ad_id: "120246979966760" },
      })
    ).toBe("120246979966760");
  });

  it("ignores campaign names that leaked in as keys", async () => {
    expect(
      await rpc("metric_ad_id_from_params", {
        params: { "Love +Reality Show - 12/12/2025": "120777666555" },
      })
    ).toBeNull();
  });

  it("returns null for an empty object", async () => {
    expect(await rpc("metric_ad_id_from_params", { params: {} })).toBeNull();
  });
});

describe("metric_campaign_id_from_url", () => {
  it("extracts a numeric utm_id", async () => {
    expect(await rpc("metric_campaign_id_from_url", { url: OCCULT_URL })).toBe(
      "120987654321"
    );
  });

  it("preserves a non-numeric campaign id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=june-test-01" })
    ).toBe("june-test-01");
  });
});

describe("metric_clean_utm_source", () => {
  it("strips a leaked utm_source= prefix", async () => {
    expect(await rpc("metric_clean_utm_source", { raw: "utm_source=METAxAM" })).toBe(
      "METAxAM"
    );
  });

  it("leaves a clean value untouched, so both forms aggregate as one", async () => {
    expect(await rpc("metric_clean_utm_source", { raw: "METAxAM" })).toBe("METAxAM");
  });

  it("returns null for null and empty input", async () => {
    expect(await rpc("metric_clean_utm_source", { raw: null })).toBeNull();
    expect(await rpc("metric_clean_utm_source", { raw: "" })).toBeNull();
  });
});

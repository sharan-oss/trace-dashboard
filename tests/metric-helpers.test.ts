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

  it("skips an earlier junk match to find a valid ad id later in the query string", async () => {
    // A prior implementation took the first *key* match and normalized
    // afterwards, so a junk first occurrence (the unexpanded macro) shadowed
    // the valid h_ad_id later in the string. It must scan every match, like
    // metric_ad_id_from_params does over jsonb keys.
    expect(
      await rpc("metric_ad_id_from_url", {
        url: "https://x.com/?utm_term=999&Ad+ID=%7b%7bad.id%7d%7d&h_ad_id=120111222333",
      })
    ).toBe("120111222333");
  });

  it("extracts a double-encoded 'Ad%2BID' key", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad%2BID=120333444555" })
    ).toBe("120333444555");
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

  it("reads an 'Ad_id' key (the shape on 224 live payments rows)", async () => {
    expect(
      await rpc("metric_ad_id_from_params", { params: { Ad_id: "120246979966760" } })
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

  // metric_campaign_id_from_url has no numeric guard (unlike the ad id path),
  // so metric_normalize_key's junk filter is the only thing standing between
  // these values and a phantom campaign in every breakdown. Each case below
  // fails if the corresponding branch in metric_normalize_key is removed.
  it("rejects an unexpanded {{campaign.id}} macro", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id={{campaign.id}}" })
    ).toBeNull();
  });

  it("rejects the URL-encoded %7b%7b macro form", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", {
        url: "https://x.com/?utm_id=%7b%7bcampaign.id%7d%7d",
      })
    ).toBeNull();
  });

  it("rejects the literal string 'null'", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=null" })
    ).toBeNull();
  });

  it("rejects the literal string 'undefined'", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=undefined" })
    ).toBeNull();
  });

  it("rejects the literal string '_removed_'", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=_removed_" })
    ).toBeNull();
  });

  it("rejects an empty value", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=" })
    ).toBeNull();
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

describe("metric_campaign_id_from_url — widened to the new template", () => {
  it("still reads a legacy utm_id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=120987654321" })
    ).toBe("120987654321");
  });

  it("reads campaign_id, which the new template emits and the old helper missed", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?campaign_id=120235128175530519" })
    ).toBe("120235128175530519");
  });

  it("still preserves a non-numeric campaign id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?campaign_id=june-test-01" })
    ).toBe("june-test-01");
  });

  it("skips a junk value to find a valid campaign id later in the string", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", {
        url: "https://x.com/?utm_id=%7b%7bcampaign.id%7d%7d&campaign_id=120235128175530519",
      })
    ).toBe("120235128175530519");
  });

  it("does not match fbclid or fbc_id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?fbclid=120999888777&fbc_id=120555444333" })
    ).toBeNull();
  });
});

describe("metric_campaign_id_from_params", () => {
  it("reads utm_id", async () => {
    expect(await rpc("metric_campaign_id_from_params", { params: { utm_id: "120987654321" } })).toBe(
      "120987654321"
    );
  });

  it("reads campaign_id", async () => {
    expect(
      await rpc("metric_campaign_id_from_params", { params: { campaign_id: "120235128175530519" } })
    ).toBe("120235128175530519");
  });

  it("rejects an unexpanded macro", async () => {
    expect(
      await rpc("metric_campaign_id_from_params", { params: { utm_id: "{{campaign.id}}" } })
    ).toBeNull();
  });

  it("ignores fbc_id, which is an ad set id, not a campaign id", async () => {
    expect(
      await rpc("metric_campaign_id_from_params", { params: { fbc_id: "120555444333" } })
    ).toBeNull();
  });
});

describe("metric_adset_id_from_url", () => {
  it("reads fbc_id, the ad set id both templates emit", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?fbc_id=120237239322730519" })
    ).toBe("120237239322730519");
  });

  it("reads a numeric utm_term, the legacy ad set id era", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?utm_term=120237239322730519" })
    ).toBe("120237239322730519");
  });

  it("rejects a non-numeric utm_term, which is an ad set NAME, not an id", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?utm_term=OTG+-+15%2F1%2F2026" })
    ).toBeNull();
  });

  it("prefers a valid id over a name when both eras appear together", async () => {
    expect(
      await rpc("metric_adset_id_from_url", {
        url: "https://x.com/?utm_term=OTG+-+15%2F1%2F2026&fbc_id=120237239322730519",
      })
    ).toBe("120237239322730519");
  });

  it("does not match fbclid (the LIKE underscore-wildcard trap)", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?fbclid=120999888777" })
    ).toBeNull();
  });

  it("rejects an unexpanded macro", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?fbc_id=%7b%7badset.id%7d%7d" })
    ).toBeNull();
  });
});

describe("metric_adset_id_from_params", () => {
  it("reads fbc_id", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { fbc_id: "120237239322730519" } })
    ).toBe("120237239322730519");
  });

  it("reads a numeric utm_term", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { utm_term: "120237239322730519" } })
    ).toBe("120237239322730519");
  });

  it("rejects a non-numeric utm_term", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { utm_term: "OTG - 15/1/2026" } })
    ).toBeNull();
  });

  it("never returns the ad id when only an ad id is present", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { h_ad_id: "120242114093820519" } })
    ).toBeNull();
  });
});

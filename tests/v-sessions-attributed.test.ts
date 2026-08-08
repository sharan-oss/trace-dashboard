import { describe, expect, it } from "vitest";
import {
  adminClient,
  clientClient,
  countRows,
  expectStableEqualCounts,
} from "./helpers/supabase";

const VIEW = "v_sessions_attributed";

describe(`${VIEW} — shape`, () => {
  it("returns exactly one row per session, adding and dropping none", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "sessions");
  });

  it("exposes every base sessions column alongside the derived ones", async () => {
    const admin = await adminClient();
    const [viewRow, tableRow] = await Promise.all([
      admin.from(VIEW).select("*").limit(1).single(),
      admin.from("sessions").select("*").limit(1).single(),
    ]);
    if (viewRow.error) throw new Error(viewRow.error.message);
    if (tableRow.error) throw new Error(tableRow.error.message);
    for (const column of Object.keys(tableRow.data)) {
      expect(Object.keys(viewRow.data)).toContain(column);
    }
  });

  it("sets day_ist on every row", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .is("day_ist", null);
    if (error) throw new Error(error.message);
    expect(count).toBe(0);
  });

  it("leaves no utm_source_clean carrying the leaked prefix", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("utm_source_clean")
      .not("utm_source_clean", "is", null)
      .limit(5000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.utm_source_clean.startsWith("utm_source=")).toBe(false);
    }
  });
});

describe(`${VIEW} — key resolution`, () => {
  it("classifies every row as ad_id, ad_name or none, with the key agreeing", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("ad_key, ad_key_type").limit(3000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(["ad_id", "ad_name", "none"]).toContain(row.ad_key_type);
      if (row.ad_key_type === "none") expect(row.ad_key).toBeNull();
      else expect(row.ad_key).not.toBeNull();
    }
  });

  it("emits only numeric identifiers when ad_key_type is ad_id", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key")
      .eq("ad_key_type", "ad_id")
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  it("prefers the stored id over extraction — every stored ad_id survives into ad_key", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_id, ad_key, ad_key_type")
      .not("ad_id", "is", null)
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.ad_key).toBe(row.ad_id);
      expect(row.ad_key_type).toBe("ad_id");
    }
  });

  it("resolves ad keys by extraction for a client with no stored ids and no seeded ads", async () => {
    // Occultyogis Vastu: zero stored ids, zero rows in `ads`, but ~2,000
    // extractable ad ids. This is the regression that would break a design
    // reading only stored columns or requiring an `ads` row to exist.
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("client_id, ad_key, ad_key_type, ad_name")
      .is("ad_id", null)
      .eq("ad_key_type", "ad_id")
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  it("never resolves an ad name that is ambiguous within its campaign", async () => {
    const admin = await adminClient();
    const { data: ads, error: adsError } = await admin
      .from("ads")
      .select("client_id, meta_campaign_id, ad_name, meta_ad_id");
    if (adsError) throw new Error(adsError.message);

    const counts = new Map<string, Set<string>>();
    for (const ad of ads!) {
      const key = `${ad.client_id}|${ad.meta_campaign_id}|${ad.ad_name}`;
      if (!counts.has(key)) counts.set(key, new Set());
      counts.get(key)!.add(ad.meta_ad_id);
    }
    const ambiguous = [...counts.entries()].filter(([, ids]) => ids.size > 1);
    expect(ambiguous.length).toBeGreaterThan(0); // the fixture this test needs exists

    const { data: named, error } = await admin
      .from(VIEW)
      .select("client_id, campaign_key, utm_content, ad_key")
      .eq("ad_key_type", "ad_name")
      .limit(3000);
    if (error) throw new Error(error.message);
    const ambiguousKeys = new Set(ambiguous.map(([key]) => key));
    for (const row of named!) {
      expect(ambiguousKeys.has(`${row.client_id}|${row.campaign_key}|${row.utm_content}`)).toBe(
        false
      );
    }
  });

  it("only ever name-matches a row that resolved no id", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_id, ad_key_type")
      .eq("ad_key_type", "ad_name")
      .limit(2000);
    if (error) throw new Error(error.message);
    // Without this, the assertion below is vacuously true the moment name
    // matching stops resolving any row at all.
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_id).toBeNull();
  });
});

describe(`${VIEW} — three-tier attribution`, () => {
  it("assigns the most specific tier that resolved", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, adset_key, campaign_key, attribution_tier")
      .limit(3000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      const expected =
        row.ad_key !== null
          ? "ad"
          : row.adset_key !== null
            ? "adset"
            : row.campaign_key !== null
              ? "campaign"
              : "none";
      expect(row.attribution_tier).toBe(expected);
    }
  });

  it("resolves all three tiers for at least some rows", async () => {
    const admin = await adminClient();
    for (const tier of ["ad", "adset", "campaign"]) {
      const { count, error } = await admin
        .from(VIEW)
        .select("*", { count: "exact", head: true })
        .eq("attribution_tier", tier);
      if (error) throw new Error(error.message);
      expect(count, `expected at least one row at tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("fills the hierarchy from ads whenever the ad resolved to a seeded ad", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, adset_key, campaign_key, ad_name, campaign_name")
      .not("ad_name", "is", null)
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.adset_key).not.toBeNull();
      expect(row.campaign_key).not.toBeNull();
      expect(row.campaign_name).not.toBeNull();
    }
  });
});

describe(`${VIEW} — RLS (AC-6)`, () => {
  it("scopes the client identity strictly below admin", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, VIEW),
      countRows(client, VIEW),
    ]);
    expect(clientCount).toBeGreaterThan(0);
    expect(clientCount).toBeLessThan(adminCount);
  });

  it("returns exactly one client_id to the client identity", async () => {
    const client = await clientClient();
    const { data, error } = await client.from(VIEW).select("client_id").limit(3000);
    if (error) throw new Error(error.message);
    expect(new Set(data!.map((r) => r.client_id)).size).toBe(1);
  });
});

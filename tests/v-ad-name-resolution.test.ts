import { describe, expect, it } from "vitest";
import { adminClient, clientClient, countRows } from "./helpers/supabase";

const VIEW = "v_ad_name_resolution";

type Triple = { client_id: string; meta_campaign_id: string; ad_name: string };

/** Groups raw `ads` rows by (client_id, meta_campaign_id, ad_name), the same
 * key v_ad_name_resolution groups by, so tests can find a known-ambiguous and
 * a known-unique triple straight from source data. */
async function groupAdsByTriple(): Promise<
  Map<string, { triple: Triple; ids: Set<string> }>
> {
  const admin = await adminClient();
  const { data: ads, error } = await admin
    .from("ads")
    .select("client_id, meta_campaign_id, ad_name, meta_ad_id");
  if (error) throw new Error(error.message);

  const groups = new Map<string, { triple: Triple; ids: Set<string> }>();
  for (const ad of ads!) {
    const key = JSON.stringify([ad.client_id, ad.meta_campaign_id, ad.ad_name]);
    if (!groups.has(key)) {
      groups.set(key, {
        triple: {
          client_id: ad.client_id,
          meta_campaign_id: ad.meta_campaign_id,
          ad_name: ad.ad_name,
        },
        ids: new Set(),
      });
    }
    groups.get(key)!.ids.add(ad.meta_ad_id);
  }
  return groups;
}

describe(VIEW, () => {
  it("excludes every name ambiguous within its campaign", async () => {
    // Directly exercises the `having count(distinct meta_ad_id) = 1` guard.
    // Removing that clause lets the ambiguous triple through with a
    // (arbitrary, min()-picked) meta_ad_id -- this test goes red the moment
    // that happens.
    const groups = await groupAdsByTriple();
    const ambiguous = [...groups.values()].filter((g) => g.ids.size > 1);
    expect(ambiguous.length).toBeGreaterThan(0); // the fixture this test needs exists

    const admin = await adminClient();
    for (const { triple } of ambiguous) {
      const { data, error } = await admin
        .from(VIEW)
        .select("meta_ad_id")
        .eq("client_id", triple.client_id)
        .eq("meta_campaign_id", triple.meta_campaign_id)
        .eq("ad_name", triple.ad_name.trim());
      if (error) throw new Error(error.message);
      expect(data).toEqual([]);
    }
  });

  it("includes a name unique within its campaign, mapped to the correct ad", async () => {
    const groups = await groupAdsByTriple();
    const unique = [...groups.values()].find((g) => g.ids.size === 1);
    expect(unique).toBeDefined();
    const { triple, ids } = unique!;
    const expectedAdId = [...ids][0];

    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("meta_ad_id")
      .eq("client_id", triple.client_id)
      .eq("meta_campaign_id", triple.meta_campaign_id)
      .eq("ad_name", triple.ad_name.trim())
      .single();
    if (error) throw new Error(error.message);
    expect(data!.meta_ad_id).toBe(expectedAdId);
  });

  it("never repeats a (client_id, meta_campaign_id, ad_name) triple", async () => {
    // This is what makes the join in v_sessions_attributed incapable of
    // multiplying rows. Dropping client_id from the grouping key is the
    // mutation this guards against.
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("client_id, meta_campaign_id, ad_name")
      .limit(5000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);

    const seen = new Set<string>();
    for (const row of data!) {
      const key = JSON.stringify([row.client_id, row.meta_campaign_id, row.ad_name]);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("never points a row's client_id to a different client's ad", async () => {
    // Directly asserts the cross-tenant guard: an admin can see every
    // client's ads, so without client_id in the grouping key one client's
    // name could resolve to another client's ad.
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("client_id, meta_ad_id").limit(5000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);

    const adIds = data!.map((r) => r.meta_ad_id);
    const { data: ads, error: adsError } = await admin
      .from("ads")
      .select("meta_ad_id, client_id")
      .in("meta_ad_id", adIds);
    if (adsError) throw new Error(adsError.message);
    const adClientById = new Map(ads!.map((a) => [a.meta_ad_id, a.client_id]));

    for (const row of data!) {
      expect(adClientById.get(row.meta_ad_id)).toBe(row.client_id);
    }
  });
});

describe(`${VIEW} — RLS`, () => {
  it("scopes the client identity to its own rows only", async () => {
    const client = await clientClient();
    const { data, error } = await client.from(VIEW).select("client_id").limit(3000);
    if (error) throw new Error(error.message);
    if (data!.length > 0) {
      expect(new Set(data!.map((r) => r.client_id)).size).toBe(1);
    }
  });

  it("returns at least as many rows to admin as to the client identity", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, VIEW),
      countRows(client, VIEW),
    ]);
    expect(adminCount).toBeGreaterThanOrEqual(clientCount);
  });
});

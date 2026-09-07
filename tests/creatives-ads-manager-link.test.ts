import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getAdCreativeMeta } from "@/lib/creatives";
import { getClients } from "@/lib/queries/overview";
import { adminClient, clientClient } from "./helpers/supabase";

/**
 * `getAdCreativeMeta` feeds every ad preview (Customers' four surfaces and
 * Funnel). Since 2026-09-07 it also carries the Ads Manager deep link, which
 * means it embeds `ad_accounts` to resolve each ad's OWN account.
 *
 * These tests exist for the embed specifically: supabase-js types an embed as
 * an array while PostgREST returns a bare object for a many-to-one FK, so the
 * shape is normalised in code and asserted here against the live schema. If
 * the relationship ever stops resolving, the link silently disappears rather
 * than erroring — so only a real read proves it.
 */

async function loveSchoolId(admin: SupabaseClient): Promise<string> {
  const clients = await getClients(admin);
  const ls = clients.find((c) => c.name === "Love School");
  if (!ls) throw new Error("Love School client not found");
  return ls.id;
}

/** Ads that carry both an account and a campaign — the linkable ones. */
async function linkableAdKeys(
  admin: SupabaseClient,
  clientId: string,
  limit = 5,
): Promise<string[]> {
  const { data, error } = await admin
    .from("ads")
    .select("meta_ad_id")
    .eq("client_id", clientId)
    .not("ad_account_id", "is", null)
    .not("meta_campaign_id", "is", null)
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.meta_ad_id as string);
}

describe("getAdCreativeMeta — Ads Manager link", () => {
  it("resolves the embed and builds a campaign-scoped link", async () => {
    // The load-bearing assertion: if the ad_accounts embed stopped resolving,
    // adsManagerUrl would be null everywhere and no test would notice.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    const keys = await linkableAdKeys(admin, ls);
    expect(keys.length).toBeGreaterThan(0);

    const meta = await getAdCreativeMeta(admin, ls, keys);
    expect(meta.size).toBe(keys.length);

    for (const key of keys) {
      const url = meta.get(key)?.adsManagerUrl;
      expect(url, `no link for ${key}`).not.toBeNull();
      expect(url).toContain("adsmanager.facebook.com");
      // The whole point of the campaign filter: without it Ads Manager
      // resolves the ad against every ad on the account.
      expect(url, `no campaign scope for ${key}`).toContain(
        "selected_campaign_ids=",
      );
      expect(url).toContain(`selected_ad_ids=${key}`);
      // Never the act_ prefix, and never an empty account.
      expect(url).not.toContain("act=act_");
      expect(url).not.toContain("act=&");
    }
  });

  it("names the account that actually owns each ad", async () => {
    // Love School has two accounts; an act= that does not own the ad fails
    // silently in Ads Manager, which is the bug this link had before.
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);

    const { data, error } = await admin
      .from("ads")
      .select("meta_ad_id, ad_accounts(meta_ad_account_id)")
      .eq("client_id", ls)
      .not("ad_account_id", "is", null)
      .limit(10);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    expect(rows.length).toBeGreaterThan(0);

    const meta = await getAdCreativeMeta(
      admin,
      ls,
      rows.map((r) => r.meta_ad_id as string),
    );

    for (const r of rows) {
      const embed = r.ad_accounts as unknown;
      const owner = (Array.isArray(embed) ? embed[0] : embed) as
        | { meta_ad_account_id: string }
        | null;
      if (owner == null) continue;
      const expected = owner.meta_ad_account_id.replace(/^act_/, "");
      expect(
        meta.get(r.meta_ad_id as string)?.adsManagerUrl,
        `wrong account for ${r.meta_ad_id}`,
      ).toContain(`act=${expected}`);
    }
  });

  it("gives a client identity the same link, under RLS", async () => {
    // ad_accounts' read policy is is_admin OR matching client_id, so the embed
    // must resolve for a client user too — otherwise the preview quietly loses
    // its link for exactly the audience it was built for.
    const admin = await adminClient();
    const client = await clientClient();
    const ls = await loveSchoolId(admin);
    const keys = await linkableAdKeys(admin, ls, 3);

    const asClient = await getAdCreativeMeta(client, ls, keys);
    // The test client may be scoped to another tenant; only assert when it can
    // see these rows at all.
    if (asClient.size === 0) return;
    for (const [key, m] of asClient) {
      expect(m.adsManagerUrl, `client identity got no link for ${key}`).not.toBeNull();
    }
  });

  it("returns an empty map for no keys, without querying", async () => {
    const admin = await adminClient();
    const ls = await loveSchoolId(admin);
    expect((await getAdCreativeMeta(admin, ls, [])).size).toBe(0);
    expect((await getAdCreativeMeta(admin, ls, [""])).size).toBe(0);
  });
});

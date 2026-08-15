/**
 * The shared creative-signing helper, against the live bucket and ads
 * dimension. Love School has 1,233 mirrored thumbnails, so real paths exist to
 * sign without any fixture.
 */
import { describe, expect, it } from "vitest";
import { adminClient } from "./helpers/supabase";
import { getAdCreativeMeta, signCreativePaths } from "@/lib/creatives";

async function loveSchoolId() {
  const admin = await adminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id")
    .eq("name", "Love School")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

describe("getAdCreativeMeta", () => {
  it("returns entries only for the requested keys, thumbnails signed", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const { data: ads, error } = await admin
      .from("ads")
      .select("meta_ad_id, creative_thumbnail_path")
      .eq("client_id", clientId)
      .not("creative_thumbnail_path", "is", null)
      .limit(3);
    expect(error).toBeNull();
    expect(ads!.length).toBeGreaterThan(0);

    const keys = ads!.map((a) => a.meta_ad_id as string);
    const meta = await getAdCreativeMeta(admin, clientId, [
      ...keys,
      "999999999999999999", // unknown ad key — must simply be absent
    ]);

    expect(meta.size).toBe(keys.length);
    for (const key of keys) {
      const entry = meta.get(key);
      expect(entry).toBeDefined();
      expect(entry!.thumbUrl).toMatch(/^https?:\/\//);
      expect(meta.has("999999999999999999")).toBe(false);
    }
  });

  it("returns an empty map for an empty key set without touching the network", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const meta = await getAdCreativeMeta(admin, clientId, []);
    expect(meta.size).toBe(0);
  });
});

describe("signCreativePaths", () => {
  it("signs real paths and silently omits nonexistent ones", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const { data: ads } = await admin
      .from("ads")
      .select("creative_thumbnail_path")
      .eq("client_id", clientId)
      .not("creative_thumbnail_path", "is", null)
      .limit(2);
    const real = ads!.map((a) => a.creative_thumbnail_path as string);
    const signed = await signCreativePaths(admin, [
      ...real,
      "nonexistent/path.jpg",
    ]);
    for (const path of real) {
      expect(signed.get(path)).toMatch(/^https?:\/\//);
    }
    expect(signed.has("nonexistent/path.jpg")).toBe(false);
  });
});

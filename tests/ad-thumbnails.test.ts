/**
 * Thumbnail mirroring against the live bucket with a FAKE image fetch — no
 * call ever leaves for Meta's CDN. Fixture ads use meta_ad_id
 * 'test_thumb_ad_%' and a fixture ad_accounts row; storage objects and ads
 * rows are cleaned up afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSyncClient } from "@/lib/auth/service-identity";
import { CREATIVES_BUCKET, mirrorThumbnails } from "@/lib/meta/thumbnails";

// 1x1 transparent PNG.
const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

function okImageFetch() {
  return (async () =>
    new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as unknown as typeof fetch;
}

function failingFetch() {
  return (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
}

let db: SupabaseClient;
let accountId: string;
let clientId: string;
const AD_IDS = ["test_thumb_ad_1", "test_thumb_ad_2"];

async function insertFixtureAds() {
  const rows = AD_IDS.map((metaAdId, i) => ({
    client_id: clientId,
    ad_account_id: accountId,
    meta_ad_id: metaAdId,
    meta_adset_id: "test_thumb_adset",
    meta_campaign_id: "test_thumb_campaign",
    ad_name: `Thumb Test ${i + 1}`,
    adset_name: "Thumb Adset",
    campaign_name: "Thumb Campaign",
    status: "active",
    creative_source_url: `https://example.invalid/${metaAdId}.png`,
    creative_thumbnail_path: null,
  }));
  const { error } = await db.from("ads").upsert(rows, { onConflict: "meta_ad_id" });
  expect(error).toBeNull();
}

beforeAll(async () => {
  db = await createSyncClient();
  const { data: client } = await db.from("clients").select("id").eq("name", "Love School").single();
  // Same fixture row ads-sync.test.ts uses; upserted here too so neither file
  // depends on the other having run first.
  const { data: fixture, error } = await db
    .from("ad_accounts")
    .upsert(
      {
        client_id: client!.id,
        meta_ad_account_id: "act_test_sync_fixture",
        name: "TEST FIXTURE — sync tests, never a real account",
        currency: "INR",
        timezone_name: "Asia/Kolkata",
        status: "disconnected",
      },
      { onConflict: "meta_ad_account_id" }
    )
    .select("id, client_id")
    .single();
  expect(error).toBeNull();
  accountId = fixture!.id;
  clientId = fixture!.client_id;
});

afterAll(async () => {
  await db.storage
    .from(CREATIVES_BUCKET)
    .remove(AD_IDS.map((id) => `${clientId}/${id}.jpg`));
  await db.from("ads").delete().like("meta_ad_id", "test_thumb_ad_%");
});

describe("mirrorThumbnails", () => {
  it("downloads, uploads to the private bucket, and stores the path", async () => {
    await insertFixtureAds();
    const result = await mirrorThumbnails({
      db,
      accountId,
      fetchImpl: okImageFetch(),
    });
    expect(result.mirrored).toBe(2);
    expect(result.failed).toBe(0);

    const { data: ad } = await db
      .from("ads")
      .select("creative_thumbnail_path")
      .eq("meta_ad_id", "test_thumb_ad_1")
      .single();
    expect(ad?.creative_thumbnail_path).toBe(`${clientId}/test_thumb_ad_1.jpg`);

    const { data: blob, error } = await db.storage
      .from(CREATIVES_BUCKET)
      .download(`${clientId}/test_thumb_ad_1.jpg`);
    expect(error).toBeNull();
    expect(blob!.size).toBe(PNG_BYTES.byteLength);
  });

  it("does not re-mirror ads that already have a path", async () => {
    const again = await mirrorThumbnails({ db, accountId, fetchImpl: okImageFetch() });
    expect(again.mirrored).toBe(0);
  });

  it("respects the per-run cap", async () => {
    await db.from("ads").update({ creative_thumbnail_path: null }).like("meta_ad_id", "test_thumb_ad_%");
    const result = await mirrorThumbnails({
      db,
      accountId,
      limit: 1,
      fetchImpl: okImageFetch(),
    });
    expect(result.mirrored).toBe(1);
  });

  it("counts failures without throwing and leaves the path null", async () => {
    await db.from("ads").update({ creative_thumbnail_path: null }).like("meta_ad_id", "test_thumb_ad_%");
    const result = await mirrorThumbnails({
      db,
      accountId,
      fetchImpl: failingFetch(),
    });
    expect(result.failed).toBe(2);
    expect(result.mirrored).toBe(0);

    const { data: ad } = await db
      .from("ads")
      .select("creative_thumbnail_path")
      .eq("meta_ad_id", "test_thumb_ad_1")
      .single();
    expect(ad?.creative_thumbnail_path).toBeNull();
  });
});

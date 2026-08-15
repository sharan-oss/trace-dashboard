import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signed access to the private `ad-creatives` bucket, shared by every surface
 * that shows a creative (the Ads cards, and the Customers section's ad
 * previews). The bucket is private with the path `{client_id}/{meta_ad_id}.jpg`
 * as the tenant boundary, so nothing renders without a short-lived signed URL
 * minted server-side.
 */

const CREATIVES_BUCKET = "ad-creatives";
const SIGNED_URL_TTL_S = 3600;
/** createSignedUrls has request-size limits; chunk well under them. */
const SIGN_CHUNK = 200;

/**
 * Signed URLs for a set of storage paths, keyed by path. Paths that fail to
 * sign are simply absent — callers render their no-creative state rather than
 * a broken image.
 */
export async function signCreativePaths(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += SIGN_CHUNK) {
    const chunk = paths.slice(i, i + SIGN_CHUNK);
    const { data: signed } = await supabase.storage
      .from(CREATIVES_BUCKET)
      .createSignedUrls(chunk, SIGNED_URL_TTL_S);
    for (const s of signed ?? []) {
      if (s.path != null && s.signedUrl != null && s.error == null) {
        out.set(s.path, s.signedUrl);
      }
    }
  }
  return out;
}

export type AdCreativeMeta = {
  thumbUrl: string | null;
  adName: string | null;
  campaignName: string | null;
  status: string;
};

/**
 * Creative + naming for a specific set of ad keys — the ads actually on
 * screen, so the read is keyed (`in`) and bounded by page size, never a scan
 * of the dimension. Keys with no `ads` row are absent from the result; the
 * preview component says "no creative synced" instead of guessing.
 */
export async function getAdCreativeMeta(
  supabase: SupabaseClient,
  clientId: string,
  adKeys: string[],
): Promise<Map<string, AdCreativeMeta>> {
  const keys = [...new Set(adKeys)].filter((k) => k.length > 0);
  if (keys.length === 0) return new Map();

  const { data, error } = await supabase
    .from("ads")
    .select("meta_ad_id, ad_name, campaign_name, status, creative_thumbnail_path")
    .eq("client_id", clientId)
    .in("meta_ad_id", keys);
  if (error) throw new Error(`ads creative read failed: ${error.message}`);

  const rows = data ?? [];
  const paths = rows
    .map((r) => r.creative_thumbnail_path as string | null)
    .filter((p): p is string => p != null);
  const signed = await signCreativePaths(supabase, paths);

  const out = new Map<string, AdCreativeMeta>();
  for (const r of rows) {
    const path = r.creative_thumbnail_path as string | null;
    out.set(r.meta_ad_id as string, {
      thumbUrl: path != null ? (signed.get(path) ?? null) : null,
      adName: (r.ad_name as string | null) ?? null,
      campaignName: (r.campaign_name as string | null) ?? null,
      status: r.status as string,
    });
  }
  return out;
}

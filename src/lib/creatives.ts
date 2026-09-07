import type { SupabaseClient } from "@supabase/supabase-js";
import { adsManagerUrl } from "@/lib/meta/ads-manager";

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

/**
 * The `act_…` id out of an embedded `ad_accounts` row.
 *
 * supabase-js types every embed as an array because it cannot tell a to-one
 * relationship from a to-many, while PostgREST returns a bare object for a
 * many-to-one FK like `ads.ad_account_id`. Both shapes are accepted rather
 * than asserting one, since guessing wrong here would silently return no link
 * at all — and null is the honest answer for an ad the sync has not yet
 * claimed for an account.
 */
function embeddedAccount(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (row == null || typeof row !== "object") return null;
  const id = (row as { meta_ad_account_id?: unknown }).meta_ad_account_id;
  return typeof id === "string" ? id : null;
}

export type AdCreativeMeta = {
  thumbUrl: string | null;
  adName: string | null;
  campaignName: string | null;
  status: string;
  /**
   * Campaign-scoped deep link into Ads Manager, or null when this ad's account
   * or campaign is unknown — the preview then offers no link rather than one
   * that dumps the viewer into the account's entire ad list.
   */
  adsManagerUrl: string | null;
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
    // ad_accounts is embedded rather than looked up separately so each ad
    // resolves its OWN account: a client can have several (Love School has
    // two) and an Ads Manager link naming the wrong one fails silently.
    .select(
      "meta_ad_id, ad_name, campaign_name, status, creative_thumbnail_path, meta_campaign_id, ad_accounts(meta_ad_account_id)",
    )
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
    const account = embeddedAccount(r.ad_accounts);
    out.set(r.meta_ad_id as string, {
      thumbUrl: path != null ? (signed.get(path) ?? null) : null,
      adName: (r.ad_name as string | null) ?? null,
      campaignName: (r.campaign_name as string | null) ?? null,
      status: r.status as string,
      adsManagerUrl: adsManagerUrl(
        account,
        r.meta_ad_id as string,
        r.meta_campaign_id as string | null,
      ),
    });
  }
  return out;
}

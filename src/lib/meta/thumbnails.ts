/**
 * Creative thumbnail mirroring (AC-11).
 *
 * Meta's thumbnail URLs are signed and expire, so the bytes are copied into
 * the private 'ad-creatives' bucket and the object path stored on the ads row.
 * Paths are '{client_id}/{meta_ad_id}.jpg' — the leading folder is the tenant
 * boundary the bucket's RLS policies enforce.
 *
 * Mirrors only ads whose creative_thumbnail_path is still null; uploads use
 * upsert so a future re-mirror (creative swap) just overwrites in place. A
 * failed download or upload never throws — spend data matters more than
 * pictures — it is counted and reported so the run can go 'partial'.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CREATIVES_BUCKET = "ad-creatives";

export type MirrorResult = { mirrored: number; failed: number };

export type MirrorOptions = {
  db: SupabaseClient;
  /** ad_accounts.id — mirroring is always scoped to one account's ads. */
  accountId: string;
  /** Max mirrors this call; omit for uncapped (the local backfill). */
  limit?: number;
  fetchImpl?: typeof fetch;
};

export async function mirrorThumbnails(options: MirrorOptions): Promise<MirrorResult> {
  const { db, accountId, limit } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  let query = db
    .from("ads")
    .select("id, client_id, meta_ad_id, creative_source_url")
    .eq("ad_account_id", accountId)
    .not("creative_source_url", "is", null)
    .is("creative_thumbnail_path", null);
  if (limit !== undefined) query = query.limit(limit);

  const { data: pending, error } = await query;
  if (error) throw new Error(`thumbnail candidate query failed: ${error.message}`);

  let mirrored = 0;
  let failed = 0;

  for (const ad of pending ?? []) {
    try {
      const response = await doFetch(ad.creative_source_url as string);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const path = `${ad.client_id}/${ad.meta_ad_id}.jpg`;

      const { error: uploadError } = await db.storage
        .from(CREATIVES_BUCKET)
        .upload(path, bytes, {
          contentType: response.headers.get("content-type") ?? "image/jpeg",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { error: updateError } = await db
        .from("ads")
        .update({ creative_thumbnail_path: path })
        .eq("id", ad.id);
      if (updateError) throw new Error(updateError.message);

      mirrored += 1;
    } catch {
      failed += 1;
    }
  }

  return { mirrored, failed };
}

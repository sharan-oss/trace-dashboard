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
  /** Epoch-ms invocation budget. Mirroring stops (never throws) once past it:
   * unmirrored ads keep a null path and the next run picks them up. */
  deadlineAt?: number;
};

export async function mirrorThumbnails(options: MirrorOptions): Promise<MirrorResult> {
  const { db, accountId, limit } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  // Paged: PostgREST caps ANY select at 1000 rows, `.limit(100000)` included
  // (verified live 2026-08-17), so the backfill's "uncapped" intent silently
  // became "first 1000" — an account with 2,540 ads kept over half its cards
  // blank however often the sync ran. Rows are consumed as they are mirrored,
  // so each page re-queries from offset 0 against a shrinking candidate set.
  const PAGE = 1000;
  const target = limit ?? Number.POSITIVE_INFINITY;
  const pending: { id: string; client_id: string; meta_ad_id: string; creative_source_url: string }[] =
    [];

  while (pending.length < target) {
    const { data, error } = await db
      .from("ads")
      .select("id, client_id, meta_ad_id, creative_source_url")
      .eq("ad_account_id", accountId)
      .not("creative_source_url", "is", null)
      .is("creative_thumbnail_path", null)
      .order("id")
      .range(pending.length, Math.min(pending.length + PAGE, target) - 1);
    if (error) throw new Error(`thumbnail candidate query failed: ${error.message}`);
    pending.push(...((data ?? []) as typeof pending));
    if (!data || data.length < PAGE) break;
  }

  let mirrored = 0;
  let failed = 0;

  for (const ad of pending ?? []) {
    if (options.deadlineAt != null && Date.now() > options.deadlineAt) break;
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

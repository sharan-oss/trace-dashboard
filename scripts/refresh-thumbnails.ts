/**
 * One-off thumbnail refresh (2026-08-13): re-mirror every ad creative at
 * 720x720.
 *
 * Why: Meta's thumbnail_url DEFAULTS TO 64x64 (probed live — ~1.5KB files),
 * and video ads carry no image_url, so the Slice C mirror stored 64px images
 * that render blurry on the Ads cards. The sync now requests
 * creative.thumbnail_width(720).thumbnail_height(720); this script refreshes
 * the source URLs for EXISTING ads and re-downloads every creative over the
 * old bytes (storage upload is upsert, same '{client_id}/{meta_ad_id}.jpg'
 * paths, so nothing else changes). New ads get 720px automatically from the
 * nightly sync; only rows mirrored before the fix need this.
 *
 * Run: npx tsx scripts/refresh-thumbnails.ts   (no dev server needed)
 *
 * Standalone like the other scripts — no project imports, because tsx does
 * not resolve the repo's "@/" path aliases. Auth: the ads-sync service
 * identity (is_admin claim), which the ads table's WITH CHECK policy and the
 * ad-creatives bucket policy both accept. Idempotent — safe to re-run.
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const GRAPH_ORIGIN = "https://graph.facebook.com";
const CREATIVES_BUCKET = "ad-creatives";
const STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"];

type MetaAdRow = {
  id: string;
  creative?: { thumbnail_url?: string; image_url?: string };
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.SYNC_IDENTITY_EMAIL;
  const password = process.env.SYNC_IDENTITY_PASSWORD;
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const appSecret = process.env.META_APP_SECRET;
  const apiVersion = process.env.META_API_VERSION ?? "v26.0";
  if (!url || !key || !email || !password || !token || !appSecret) {
    console.error("Missing Supabase/sync-identity/META_* env in .env.local");
    process.exit(2);
  }
  const proof = createHmac("sha256", appSecret).update(token).digest("hex");

  const auth = createClient(url, key);
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
  });

  async function listAds(metaAdAccountId: string): Promise<MetaAdRow[]> {
    const out: MetaAdRow[] = [];
    let next: string | undefined = (() => {
      const u = new URL(`${GRAPH_ORIGIN}/${apiVersion}/${metaAdAccountId}/ads`);
      u.searchParams.set(
        "fields",
        "id,creative.thumbnail_width(720).thumbnail_height(720){thumbnail_url,image_url}",
      );
      u.searchParams.set("effective_status", JSON.stringify(STATUSES));
      u.searchParams.set("limit", "100");
      u.searchParams.set("access_token", token!);
      u.searchParams.set("appsecret_proof", proof);
      return u.toString();
    })();
    while (next) {
      const res = await fetch(next);
      const body = (await res.json()) as {
        data?: MetaAdRow[];
        paging?: { next?: string };
        error?: { message?: string; code?: number };
      };
      if (!res.ok) throw new Error(`Graph error ${body.error?.code}: ${body.error?.message}`);
      out.push(...(body.data ?? []));
      next = body.paging?.next;
    }
    return out;
  }

  const { data: accounts, error } = await db
    .from("ad_accounts")
    .select("id, client_id, meta_ad_account_id, name")
    .eq("status", "active")
    .not("meta_ad_account_id", "like", "act_test_%");
  if (error) throw new Error(error.message);
  if (!accounts || accounts.length === 0) {
    console.log("No active ad accounts mapped — nothing to refresh.");
    return;
  }

  let refreshed = 0;
  let mirrored = 0;
  let failed = 0;
  let skipped = 0;

  for (const account of accounts) {
    console.log(`── ${account.name} (${account.meta_ad_account_id})`);
    const ads = await listAds(account.meta_ad_account_id);
    console.log(`   ${ads.length} ads listed from Meta`);

    // 1. Point existing dimension rows at the 720px source URLs. Update, not
    //    upsert: rows Meta lists but the dimension lacks are the nightly
    //    sync's job, which owns the full column mapping.
    const CHUNK = 10;
    for (let i = 0; i < ads.length; i += CHUNK) {
      await Promise.all(
        ads.slice(i, i + CHUNK).map(async (ad) => {
          const source = ad.creative?.image_url ?? ad.creative?.thumbnail_url ?? null;
          if (source == null) return;
          const { error: updateError } = await db
            .from("ads")
            .update({ creative_source_url: source })
            .eq("meta_ad_id", ad.id)
            .eq("client_id", account.client_id);
          if (updateError) throw new Error(`source-url update failed: ${updateError.message}`);
          refreshed += 1;
        }),
      );
    }

    // 2. Re-mirror EVERY ad with a source URL (the force pass) — paged past
    //    PostgREST's 1000-row cap, uploads upsert over the old 64px bytes.
    const pending: { client_id: string; meta_ad_id: string; creative_source_url: string; id: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: readError } = await db
        .from("ads")
        .select("id, client_id, meta_ad_id, creative_source_url")
        .eq("ad_account_id", account.id)
        .not("creative_source_url", "is", null)
        .order("meta_ad_id")
        .range(from, from + 999);
      if (readError) throw new Error(`dimension read failed: ${readError.message}`);
      pending.push(...((page ?? []) as typeof pending));
      if (!page || page.length < 1000) break;
    }

    for (let i = 0; i < pending.length; i += CHUNK) {
      await Promise.all(
        pending.slice(i, i + CHUNK).map(async (ad) => {
          try {
            const response = await fetch(ad.creative_source_url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength < 3_000) {
              // A 64px-era URL cached by Meta's CDN or a dead redirect; keep
              // the old file rather than overwrite with something worse.
              skipped += 1;
              return;
            }
            const path = `${ad.client_id}/${ad.meta_ad_id}.jpg`;
            const { error: uploadError } = await db.storage
              .from(CREATIVES_BUCKET)
              .upload(path, bytes, {
                contentType: response.headers.get("content-type") ?? "image/jpeg",
                upsert: true,
              });
            if (uploadError) throw new Error(uploadError.message);
            const { error: pathError } = await db
              .from("ads")
              .update({ creative_thumbnail_path: path })
              .eq("id", ad.id);
            if (pathError) throw new Error(pathError.message);
            mirrored += 1;
          } catch {
            failed += 1;
          }
        }),
      );
      if ((i / CHUNK) % 10 === 0) {
        console.log(`   mirrored ${mirrored}/${pending.length}…`);
      }
    }
  }

  console.log(
    `\nDone: ${refreshed} source URLs refreshed, ${mirrored} re-mirrored, ${skipped} skipped (tiny download), ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error("Refresh crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

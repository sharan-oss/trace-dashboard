/**
 * Historical backfill (AC-9): every active ad account, month chunks from
 * 2026-06-27 (Trace's first session day) to yesterday IST.
 *
 * Run: npx tsx scripts/backfill-ads.ts   (dev server must be running — the
 * chunks go through POST /api/ads/sync so the exact production code path is
 * exercised, with no serverless time limit locally.)
 *
 * Standalone like the access probe — no project imports, because tsx does not
 * resolve the repo's "@/" path aliases. Talks to (a) Supabase directly for the
 * resumability check, (b) the local sync endpoint for the actual work.
 *
 * Resumable per the spec: a chunk with an existing success 'backfill' run for
 * the same account and window is skipped, so a crashed backfill resumes
 * rather than restarts, and a zero-spend month keeps its success row and is
 * never re-fetched.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BACKFILL_START = "2026-06-27";
// 127.0.0.1, not localhost: Node's fetch resolves localhost to ::1 first,
// and the Next dev server binds IPv4.
const BASE_URL = process.env.SYNC_BASE_URL ?? "http://127.0.0.1:3000";
/** Effectively uncapped — the whole point of running locally. */
const THUMBNAIL_LIMIT = 100_000;

function istDay(offset: number): string {
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const base = new Date(`${todayIst}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

/** Calendar-month chunks covering [BACKFILL_START, yesterday IST]. */
function monthChunks(): Array<{ from: string; to: string }> {
  const end = istDay(-1);
  const chunks: Array<{ from: string; to: string }> = [];
  let from = BACKFILL_START;
  while (from <= end) {
    const d = new Date(`${from}T12:00:00Z`);
    const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))
      .toISOString()
      .slice(0, 10);
    const to = lastOfMonth < end ? lastOfMonth : end;
    chunks.push({ from, to });
    const next = new Date(`${to}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    from = next.toISOString().slice(0, 10);
  }
  return chunks;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.SYNC_IDENTITY_EMAIL;
  const password = process.env.SYNC_IDENTITY_PASSWORD;
  if (!url || !key || !email || !password) {
    console.error("Missing Supabase/sync-identity env in .env.local");
    process.exit(2);
  }

  const auth = createClient(url, key);
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
  });

  const { data: accounts, error } = await db
    .from("ad_accounts")
    .select("id, meta_ad_account_id, name")
    .eq("status", "active")
    .not("meta_ad_account_id", "like", "act_test_%");
  if (error) throw new Error(error.message);
  if (!accounts || accounts.length === 0) {
    console.log("No active ad accounts mapped — nothing to backfill.");
    return;
  }

  const chunks = monthChunks();
  console.log(
    `Backfilling ${accounts.length} account(s) × ${chunks.length} chunk(s), ${BACKFILL_START} → ${istDay(-1)}\n`
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const account of accounts) {
    console.log(`── ${account.name} (${account.meta_ad_account_id})`);
    for (const chunk of chunks) {
      const { data: done } = await db
        .from("ad_sync_runs")
        .select("id")
        .eq("ad_account_id", account.id)
        .eq("kind", "backfill")
        .eq("status", "success")
        .eq("date_from", chunk.from)
        .eq("date_to", chunk.to)
        .limit(1)
        .maybeSingle();
      if (done) {
        console.log(`   ${chunk.from} → ${chunk.to}: already backfilled, skipping`);
        skipped += 1;
        continue;
      }

      const response = await fetch(`${BASE_URL}/api/ads/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meta_ad_account_id: account.meta_ad_account_id,
          date_from: chunk.from,
          date_to: chunk.to,
          kind: "backfill",
          thumbnail_limit: THUMBNAIL_LIMIT,
        }),
      });
      const body = (await response.json()) as {
        result?: { status: string; rowsUpserted: number; adsSynced: number; thumbnailsMirrored: number; apiCalls: number };
        error?: string;
      };
      if (!response.ok || !body.result) {
        console.log(`   ${chunk.from} → ${chunk.to}: FAILED — ${body.error ?? response.status}`);
        failed += 1;
        continue;
      }
      const r = body.result;
      console.log(
        `   ${chunk.from} → ${chunk.to}: ${r.status} — ${r.rowsUpserted} rows, ${r.adsSynced} ads, ${r.thumbnailsMirrored} thumbnails, ${r.apiCalls} calls`
      );
      synced += 1;
    }
  }

  console.log(`\nDone: ${synced} chunk(s) synced, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error("Backfill crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

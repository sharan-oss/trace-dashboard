/**
 * /api/ads/sync — the sync trigger surface.
 *
 * GET  — nightly orchestrator (this is what Vercel Cron invokes, with the
 *        CRON_SECRET bearer attached): every active account, trailing 28-day
 *        IST window, capped thumbnail mirroring, one run row per account,
 *        failures isolated per account.
 * POST — manual targeted sync: one account, an explicit day or range.
 *
 * Both authenticated by CRON_SECRET or an admin identity. 409 when a run is
 * already in progress for the targeted account.
 */
import { z } from "zod";
import { requireCronOrAdmin } from "@/lib/auth/api-guard";
import { createSyncClient } from "@/lib/auth/service-identity";
import { createMetaClient, type MetaClient } from "@/lib/meta/client";
import { getMetaConfig } from "@/lib/meta/env";
import {
  NIGHTLY_THUMBNAIL_CAP,
  loadActiveAccounts,
  runNightlyForAccounts,
} from "@/lib/meta/nightly";
import { runAdAccountSync } from "@/lib/meta/sync";

function buildMetaClient(onRequest: () => void): MetaClient {
  const config = getMetaConfig();
  return createMetaClient({
    token: config.token,
    apiVersion: config.apiVersion,
    appSecret: config.appSecret,
    onRequest,
  });
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireCronOrAdmin(request);
  if (denied) return denied;

  const db = await createSyncClient();
  let apiCalls = 0;
  const meta = buildMetaClient(() => {
    apiCalls += 1;
  });

  const accounts = await loadActiveAccounts(db);
  const outcomes = await runNightlyForAccounts(
    { db, meta, apiCallCount: () => apiCalls, thumbnails: { limit: NIGHTLY_THUMBNAIL_CAP } },
    accounts
  );
  const failed = outcomes.filter((o) => o.outcome === "failed").length;
  return Response.json(
    { accounts: outcomes.length, failed, outcomes },
    { status: failed === outcomes.length && outcomes.length > 0 ? 502 : 200 }
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const Body = z
  .object({
    meta_ad_account_id: z.string().min(1),
    date: z.string().regex(DAY).optional(),
    date_from: z.string().regex(DAY).optional(),
    date_to: z.string().regex(DAY).optional(),
    // 'backfill' marks the run for the backfill script's resumability check;
    // 'nightly' is reserved for the GET orchestrator.
    kind: z.enum(["manual", "backfill"]).default("manual"),
    // The local backfill passes a huge limit for the uncapped initial mirror;
    // interactive calls keep the nightly cap.
    thumbnail_limit: z.number().int().positive().max(100_000).optional(),
  })
  .refine((b) => (b.date ? !b.date_from && !b.date_to : Boolean(b.date_from && b.date_to)), {
    message: "provide either date, or date_from and date_to",
  });

export async function POST(request: Request): Promise<Response> {
  const denied = await requireCronOrAdmin(request);
  if (denied) return denied;

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "meta_ad_account_id plus date, or date_from and date_to (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  const { meta_ad_account_id } = parsed.data;
  const dateFrom = parsed.data.date ?? parsed.data.date_from!;
  const dateTo = parsed.data.date ?? parsed.data.date_to!;

  const db = await createSyncClient();
  const { data: account, error } = await db
    .from("ad_accounts")
    .select("id, client_id, meta_ad_account_id, currency, status")
    .eq("meta_ad_account_id", meta_ad_account_id)
    .maybeSingle();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!account) {
    return Response.json(
      { error: `No mapping for ${meta_ad_account_id} — map it via POST /api/ads/accounts first` },
      { status: 404 }
    );
  }
  if (account.status === "disconnected") {
    return Response.json({ error: "Account is disconnected" }, { status: 422 });
  }

  let apiCalls = 0;
  const meta = buildMetaClient(() => {
    apiCalls += 1;
  });

  try {
    const result = await runAdAccountSync(
      {
        db,
        meta,
        apiCallCount: () => apiCalls,
        thumbnails: { limit: parsed.data.thumbnail_limit ?? NIGHTLY_THUMBNAIL_CAP },
      },
      account,
      dateFrom,
      dateTo,
      parsed.data.kind
    );
    if (result.conflict) {
      return Response.json(
        { error: "A sync is already running for this account", run_id: result.runningRunId },
        { status: 409 }
      );
    }
    return Response.json({ result });
  } catch (err) {
    return Response.json(
      { error: `Sync failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}

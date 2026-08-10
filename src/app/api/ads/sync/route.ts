/**
 * POST /api/ads/sync — sync one mapped ad account for one IST day.
 *
 * Authenticated by the CRON_SECRET bearer header (Vercel Cron) or an admin
 * identity. 409 when a run is already in progress for the account. The nightly
 * multi-day rolling window arrives with Slice C; this endpoint is the unit it
 * will be built from.
 */
import { z } from "zod";
import { requireCronOrAdmin } from "@/lib/auth/api-guard";
import { createSyncClient } from "@/lib/auth/service-identity";
import { createMetaClient } from "@/lib/meta/client";
import { getMetaConfig } from "@/lib/meta/env";
import { runAdAccountSync } from "@/lib/meta/sync";

const Body = z.object({
  meta_ad_account_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function POST(request: Request): Promise<Response> {
  const denied = await requireCronOrAdmin(request);
  if (denied) return denied;

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "meta_ad_account_id and date (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  const { meta_ad_account_id, date } = parsed.data;

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

  const config = getMetaConfig();
  let apiCalls = 0;
  const meta = createMetaClient({
    token: config.token,
    apiVersion: config.apiVersion,
    appSecret: config.appSecret,
    onRequest: () => {
      apiCalls += 1;
    },
  });

  try {
    const result = await runAdAccountSync(
      { db, meta, apiCallCount: () => apiCalls },
      account,
      date,
      date
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

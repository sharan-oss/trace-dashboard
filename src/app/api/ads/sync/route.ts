/**
 * /api/ads/sync — the sync trigger surface.
 *
 * GET  — nightly orchestrator (this is what Vercel Cron invokes, with the
 *        CRON_SECRET bearer attached): every active account, trailing 28-day
 *        IST window, capped thumbnail mirroring, one run row per account,
 *        failures isolated per account.
 * POST — manual targeted sync: one account, an explicit day or range.
 *
 * GET is authenticated by CRON_SECRET or an admin identity; POST additionally
 * lets a client user sync an account their own tenant owns. 409 when a run is
 * already in progress for the targeted account.
 */
import { z } from "zod";
import { requireCronOrAdmin, requireCronOrAdminOrOwner } from "@/lib/auth/api-guard";

// The nightly GET syncs EVERY account sequentially in this one invocation,
// and 60s demonstrably could not fit three: on 2026-08-16 Vercel killed the
// process mid-Occultyogis after Love School's two accounts used ~10s, leaving
// an orphaned 'running' row that wedged the account (see the stale-run lease
// in sync.ts). 300s is the Hobby plan's fluid-compute maximum.
export const maxDuration = 300;
import { createSyncClient } from "@/lib/auth/service-identity";
import { createMetaClient, type MetaClient } from "@/lib/meta/client";
import { invocationDeadline } from "@/lib/meta/deadline";
import { getMetaConfig } from "@/lib/meta/env";
import {
  NIGHTLY_THUMBNAIL_CAP,
  loadActiveAccounts,
  runNightlyForAccounts,
} from "@/lib/meta/nightly";
import { runAdAccountSync } from "@/lib/meta/sync";

function buildMetaClient(onRequest: () => void, deadlineAt?: number): MetaClient {
  const config = getMetaConfig();
  return createMetaClient({
    token: config.token,
    apiVersion: config.apiVersion,
    appSecret: config.appSecret,
    onRequest,
    deadlineAt,
  });
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireCronOrAdmin(request);
  if (denied) return denied;

  const db = await createSyncClient();
  const deadlineAt = invocationDeadline(maxDuration);

  const accounts = await loadActiveAccounts(db);
  const outcomes = await runNightlyForAccounts(
    {
      db,
      // Fresh client per account: its own score bucket (Meta's limiter is per
      // ad account) and its own api_calls counter for that account's run row.
      makeMeta: (accountDeadline) => {
        let apiCalls = 0;
        const meta = buildMetaClient(() => {
          apiCalls += 1;
        }, accountDeadline);
        return { meta, apiCallCount: () => apiCalls };
      },
      thumbnails: { limit: NIGHTLY_THUMBNAIL_CAP },
      deadlineAt,
    },
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
    /** Re-list every ad instead of only what changed. Costs more API budget;
     * needed after a schema change that adds a column the dimension fills. */
    full: z.boolean().optional(),
  })
  .refine((b) => (b.date ? !b.date_from && !b.date_to : Boolean(b.date_from && b.date_to)), {
    message: "provide either date, or date_from and date_to",
  });

export async function POST(request: Request): Promise<Response> {
  // Parsed before the guard because the owner path needs the target account,
  // but authorization still decides the response first: an unparseable body
  // yields a null id, which only cron or an admin can get past.
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  const denied = await requireCronOrAdminOrOwner(
    request,
    parsed.success ? parsed.data.meta_ad_account_id : null
  );
  if (denied) return denied;

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

  // A single targeted sync gets the whole invocation budget.
  const deadlineAt = invocationDeadline(maxDuration);
  let apiCalls = 0;
  const meta = buildMetaClient(() => {
    apiCalls += 1;
  }, deadlineAt);

  try {
    const result = await runAdAccountSync(
      {
        db,
        meta,
        apiCallCount: () => apiCalls,
        thumbnails: { limit: parsed.data.thumbnail_limit ?? NIGHTLY_THUMBNAIL_CAP },
        deadlineAt,
      },
      account,
      dateFrom,
      dateTo,
      parsed.data.kind,
      parsed.data.full ?? false
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

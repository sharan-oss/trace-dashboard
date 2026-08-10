/**
 * Admin account mapping: which Meta ad account belongs to which Trace client.
 *
 * GET  — the ad accounts the System User can see (live from Meta) plus the
 *        current mappings (from ad_accounts).
 * POST — map one Meta account to a client. 422 on unknown account or non-INR
 *        currency (so ROAS can never divide mismatched units — lifting this
 *        later is a deliberate feature), 409 when already mapped.
 *
 * Database writes go through the sync service identity — RLS WITH CHECK, never
 * the service-role key.
 */
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/api-guard";
import { createSyncClient } from "@/lib/auth/service-identity";
import { createMetaClient } from "@/lib/meta/client";
import { getMetaConfig } from "@/lib/meta/env";
import type { MetaAdAccount } from "@/lib/meta/types";

async function listMetaAccounts(): Promise<MetaAdAccount[]> {
  const config = getMetaConfig();
  const meta = createMetaClient({
    token: config.token,
    apiVersion: config.apiVersion,
    appSecret: config.appSecret,
  });
  return meta.listAdAccounts();
}

export async function GET(): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  let accounts: MetaAdAccount[];
  try {
    accounts = await listMetaAccounts();
  } catch (err) {
    return Response.json(
      { error: `Meta unreachable: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const db = await createSyncClient();
  const { data: mappings, error } = await db
    .from("ad_accounts")
    .select("id, client_id, meta_ad_account_id, name, currency, timezone_name, status, connected_at");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ accounts, mappings: mappings ?? [] });
}

const PostBody = z.object({
  client_id: z.uuid(),
  meta_ad_account_id: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = PostBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "client_id (uuid) and meta_ad_account_id are required" },
      { status: 400 }
    );
  }
  const { client_id, meta_ad_account_id } = parsed.data;

  let accounts: MetaAdAccount[];
  try {
    accounts = await listMetaAccounts();
  } catch (err) {
    return Response.json(
      { error: `Meta unreachable: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const account = accounts.find((a) => a.id === meta_ad_account_id);
  if (!account) {
    return Response.json(
      { error: `The System User cannot see ad account ${meta_ad_account_id}` },
      { status: 422 }
    );
  }
  if (account.currency !== "INR") {
    return Response.json(
      {
        error: `Account currency is ${account.currency}, not INR — mapping it would make ROAS divide mismatched units`,
      },
      { status: 422 }
    );
  }

  const db = await createSyncClient();
  const { data: existing } = await db
    .from("ad_accounts")
    .select("id")
    .eq("meta_ad_account_id", meta_ad_account_id)
    .maybeSingle();
  if (existing) {
    return Response.json({ error: "Ad account is already mapped" }, { status: 409 });
  }

  const { data, error } = await db
    .from("ad_accounts")
    .insert({
      client_id,
      meta_ad_account_id,
      name: account.name,
      currency: account.currency,
      timezone_name: account.timezone_name,
    })
    .select("id, client_id, meta_ad_account_id, name, status")
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ mapping: data }, { status: 201 });
}

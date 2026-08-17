/**
 * Auth gate for the /api/ads/* route handlers.
 *
 * The caller's identity is their own session (see src/lib/auth/session.ts),
 * verified from the request cookies. The nightly orchestrator has no session at
 * all and proves itself with CRON_SECRET instead.
 */
import { getIdentity } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

function forbidden(message = "admin only"): Response {
  return Response.json({ error: message }, { status: 403 });
}

function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  return Boolean(secret) && header === `Bearer ${secret}`;
}

/** Null when the caller is an admin; a 403 Response otherwise. */
export async function requireAdmin(): Promise<Response | null> {
  const identity = await getIdentity();
  return identity?.isAdmin ? null : forbidden();
}

/** Null when the request carries the cron secret or the caller is an admin. */
export async function requireCronOrAdmin(request: Request): Promise<Response | null> {
  if (isCron(request)) return null;
  return requireAdmin();
}

/**
 * As requireCronOrAdmin, plus a third path: a client user triggering a sync of
 * their own Meta account.
 *
 * Ownership is proven by RLS rather than an app-layer client_id comparison —
 * the caller reads ad_accounts through their own JWT, so an account belonging
 * to another tenant is simply not there to find. A null id (unparseable body)
 * can therefore never satisfy the owner path.
 */
export async function requireCronOrAdminOrOwner(
  request: Request,
  metaAdAccountId: string | null
): Promise<Response | null> {
  if (isCron(request)) return null;

  const identity = await getIdentity();
  if (identity?.isAdmin) return null;
  if (!identity?.clientId || !metaAdAccountId) return forbidden();

  const db = await createServerClient();
  const { data } = await db
    .from("ad_accounts")
    .select("id")
    .eq("meta_ad_account_id", metaAdAccountId)
    .maybeSingle();

  return data ? null : forbidden("not your ad account");
}

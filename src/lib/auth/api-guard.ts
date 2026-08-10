/**
 * Admin gate for the /api/ads/* route handlers.
 *
 * Phase 0 has no real sessions: the caller's identity IS the server's
 * dev-identity env (DEV_ROLE / DEV_CLIENT_ID), resolved by the same stub the
 * pages use. The guard decodes that JWT and requires the is_admin claim, so a
 * client-identity deployment can never invoke admin endpoints. When Phase 2
 * ships real login, swap getCurrentDevJwt() for the real session here — one
 * place, not per-route.
 *
 * The sync endpoint additionally accepts the CRON_SECRET header, proving a
 * request came from Vercel Cron rather than a browser.
 */
import { getCurrentDevJwt } from "@/lib/auth/dev-identity";

function decodeIsAdmin(jwt: string): boolean {
  try {
    const payload = jwt.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      is_admin?: unknown;
    };
    return claims.is_admin === true;
  } catch {
    return false;
  }
}

/** Null when the caller is admin; a 403 Response otherwise. */
export async function requireAdmin(): Promise<Response | null> {
  try {
    const jwt = await getCurrentDevJwt();
    if (jwt && decodeIsAdmin(jwt)) return null;
  } catch {
    // fall through to the 403
  }
  return Response.json({ error: "admin only" }, { status: 403 });
}

/** Null when the request carries the cron secret or the caller is admin. */
export async function requireCronOrAdmin(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return null;
  return requireAdmin();
}

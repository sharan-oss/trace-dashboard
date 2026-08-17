import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Who the current request is. The three fields mirror the JWT claims the
 * Custom Access Token Hook emits (see
 * supabase/migrations/20260817120000_app_users_and_auth_hook_v2.sql) — this is
 * a reader, never a second source of truth. Authorization still happens in RLS;
 * these values only decide what the UI offers.
 */
export type Identity = {
  email: string;
  /** Super admin or a member of the alttredmiinds.com domain. Sees every client. */
  isAdmin: boolean;
  /** Super admin only. Manages every app_users row rather than just their own. */
  isSuper: boolean;
  /** A client user's one account. Null for admins, who see all of them. */
  clientId: string | null;
};

/**
 * The signed-in identity, or null when there is no valid session.
 *
 * getClaims() verifies the token (locally against the project's JWKS when the
 * signing key is asymmetric) — unlike getSession(), which is not safe to trust
 * in server code. Memoized per request so a layout and its page don't verify
 * twice.
 */
export const getIdentity = cache(async (): Promise<Identity | null> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims;
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  return {
    email,
    isAdmin: claims.is_admin === true,
    isSuper: claims.is_super === true,
    clientId: typeof claims.client_id === "string" ? claims.client_id : null,
  };
});

/**
 * Whether an identity resolves to any data at all. A signed-in Google account
 * that matches no allowlist row and no team domain gets no claims, so RLS
 * would return empty everywhere — we send them to /no-access instead of
 * rendering a dashboard full of zeroes.
 */
export function hasAccess(identity: Identity): boolean {
  return identity.isAdmin || identity.clientId !== null;
}

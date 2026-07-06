/**
 * Phase 0 admin-bypass stub. There is no real login yet — this signs in as one
 * of two fixed test users (dashboard-admin-test@trace.local /
 * dashboard-client-test@trace.local, see
 * supabase/migrations/20260707000001_custom_access_token_hook.sql for how
 * their app_metadata claims reach the JWT) so RLS policies are exercised for
 * real instead of bypassed. Sessions are cached per role in memory and
 * refreshed lazily on expiry — no manual token minting or redeploying.
 * Phase 2 replaces this with actual Supabase Auth; nothing downstream should
 * import this file once real sessions exist.
 */
import { createClient } from "@supabase/supabase-js";

export type DevRole = "admin" | "client";

const TEST_USER_EMAIL: Record<DevRole, string> = {
  admin: "dashboard-admin-test@trace.local",
  client: "dashboard-client-test@trace.local",
};
const TEST_USER_PASSWORD = "trace-dashboard-phase0-test!";
const EXPIRY_BUFFER_MS = 60_000;

type CachedSession = { token: string; expiresAt: number };
const sessionCache: Partial<Record<DevRole, CachedSession>> = {};

async function signIn(role: DevRole): Promise<CachedSession> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_USER_EMAIL[role],
    password: TEST_USER_PASSWORD,
  });
  if (error) throw error;
  return {
    token: data.session!.access_token,
    expiresAt: data.session!.expires_at! * 1000,
  };
}

/** Returns a valid JWT for the given dev identity, signing in fresh if the cached one is missing or near expiry. */
export async function getDevJwt(role: DevRole): Promise<string> {
  const cached = sessionCache[role];
  if (cached && cached.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
    return cached.token;
  }
  const fresh = await signIn(role);
  sessionCache[role] = fresh;
  return fresh.token;
}

/** Resolves the "acting as" identity from DEV_ROLE / DEV_CLIENT_ID env vars, for callers that want a single current identity rather than a specific role. */
export async function getCurrentDevJwt(): Promise<string | undefined> {
  if (process.env.DEV_ROLE === "admin") {
    return getDevJwt("admin");
  }
  if (process.env.DEV_CLIENT_ID) {
    return getDevJwt("client");
  }
  return undefined;
}

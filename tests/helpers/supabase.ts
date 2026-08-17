import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClientWithJwt } from "@/lib/supabase/jwt-client";

/**
 * The suite's two identities.
 *
 * These used to come from src/lib/auth/dev-identity.ts, which was also the
 * app's identity until Phase 2 shipped real Google login. The app no longer
 * has any use for them, but the tests still need a JWT they can obtain without
 * a browser — so the sign-in lives here now, test-only. The two users carry
 * their claims in raw_app_meta_data, which the Custom Access Token Hook still
 * honours ahead of the email-based rules.
 */

type TestRole = "admin" | "client";

const TEST_USER_EMAIL: Record<TestRole, string> = {
  admin: "dashboard-admin-test@trace.local",
  client: "dashboard-client-test@trace.local",
};
const TEST_USER_PASSWORD = "trace-dashboard-phase0-test!";
const EXPIRY_BUFFER_MS = 60_000;

type CachedSession = { token: string; expiresAt: number };
const sessionCache: Partial<Record<TestRole, CachedSession>> = {};

async function signIn(role: TestRole): Promise<CachedSession> {
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

/** A valid JWT for a test identity, signing in fresh when missing or near expiry. */
export async function getTestJwt(role: TestRole): Promise<string> {
  const cached = sessionCache[role];
  if (cached && cached.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
    return cached.token;
  }
  const fresh = await signIn(role);
  sessionCache[role] = fresh;
  return fresh.token;
}

/** Supabase client carrying the admin JWT (is_admin claim) — sees every client's rows. */
export async function adminClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getTestJwt("admin"));
}

/** Supabase client carrying the test-client JWT (client_id claim) — sees one client's rows. */
export async function clientClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getTestJwt("client"));
}

/** Exact row count for a table or view under the given client, failing loudly on error. */
export async function countRows(
  supabase: SupabaseClient,
  relation: string
): Promise<number> {
  const { count, error } = await supabase
    .from(relation)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${relation}) failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Asserts two relations hold the same number of rows.
 *
 * The database is live and rows arrive during the test run, so two sequential
 * counts can legitimately disagree by a row or two. Retrying preserves an exact
 * equality assertion — a view that genuinely drops rows fails every attempt,
 * while a concurrent insert is shaken off — which a fuzzy tolerance would not.
 */
export async function expectStableEqualCounts(
  supabase: SupabaseClient,
  relationA: string,
  relationB: string,
  attempts = 3
): Promise<void> {
  let last: [number, number] = [0, 0];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const a = await countRows(supabase, relationA);
    const b = await countRows(supabase, relationB);
    if (a === b) return;
    last = [a, b];
  }
  throw new Error(
    `counts still differ after ${attempts} attempts: ${relationA}=${last[0]}, ${relationB}=${last[1]}`
  );
}

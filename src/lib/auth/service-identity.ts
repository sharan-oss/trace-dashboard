/**
 * Machine identity for the Meta ads sync.
 *
 * Deliberately separate from the human login path: a scheduled job has no
 * browser, no cookies and nobody to click a Google button, so it signs in with
 * its own credentials instead. This user exists only to run the sync.
 *
 * It authenticates with the publishable key like everything else — the
 * service-role key is forbidden inside a request handler — and relies on the
 * Custom Access Token Hook to inject its is_admin claim from
 * raw_app_meta_data. Writes then pass the new tables' WITH CHECK policies.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClientWithJwt } from "@/lib/supabase/jwt-client";

const EXPIRY_BUFFER_MS = 60_000;

let cached: { token: string; expiresAt: number } | undefined;

async function signIn(): Promise<{ token: string; expiresAt: number }> {
  const email = process.env.SYNC_IDENTITY_EMAIL;
  const password = process.env.SYNC_IDENTITY_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SYNC_IDENTITY_EMAIL and SYNC_IDENTITY_PASSWORD must be set for the ads sync"
    );
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return {
    token: data.session!.access_token,
    expiresAt: data.session!.expires_at! * 1000,
  };
}

/** A valid JWT for the sync identity, signing in fresh when missing or near expiry. */
export async function getSyncJwt(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
    return cached.token;
  }
  cached = await signIn();
  return cached.token;
}

/** Supabase client authenticated as the sync identity, writing under RLS. */
export async function createSyncClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getSyncJwt());
}

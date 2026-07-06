// Phase 0 dev-identity helper. Signs in as the two test users created for this
// project (see supabase/migrations/20260707000001_custom_access_token_hook.sql
// for how their app_metadata claims reach the JWT) and prints access tokens to
// paste into .env.local as DEV_ADMIN_JWT / DEV_CLIENT_JWT. Uses the publishable
// key only — no service-role/secret key involved. Tokens expire (~1hr); re-run
// this script to refresh.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const PASSWORD = "trace-dashboard-phase0-test!";

async function signIn(email: string) {
  const supabase = createClient(URL, PUBLISHABLE_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return data.session!.access_token;
}

async function main() {
  const adminJwt = await signIn("dashboard-admin-test@trace.local");
  const clientJwt = await signIn("dashboard-client-test@trace.local");
  console.log("DEV_ADMIN_JWT=" + adminJwt);
  console.log("DEV_CLIENT_JWT=" + clientJwt);
}

main();

/**
 * Prints the @supabase/ssr session cookies for the ADMIN TEST USER as JSON,
 * ready for Playwright's context.addCookies — for browser walks against a
 * local `next start`. Test identity only (the same one tests/helpers signs in
 * with); never a real user, never production.
 *
 *   npx tsx scripts/test-session-cookie.ts [baseUrl]   # default http://localhost:3100
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// quiet: dotenv 17 otherwise prints a banner to stdout, corrupting the JSON.
config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const base = new URL(process.argv[2] ?? "http://localhost:3100");

async function main() {
  const { data, error } = await createClient(url, key).auth.signInWithPassword({
    email: "dashboard-admin-test@trace.local",
    password: "trace-dashboard-phase0-test!",
  });
  if (error) throw error;

  // Let @supabase/ssr serialise the session exactly as the app reads it.
  const jar = new Map<string, string>();
  const ssr = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await ssr.auth.setSession({
    access_token: data.session!.access_token,
    refresh_token: data.session!.refresh_token,
  });

  const cookies = [...jar].map(([name, value]) => ({
    name,
    value,
    domain: base.hostname,
    path: "/",
    httpOnly: false,
    secure: base.protocol === "https:",
    sameSite: "Lax" as const,
  }));
  console.log(JSON.stringify(cookies));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

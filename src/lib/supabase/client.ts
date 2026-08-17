import { createBrowserClient as createCookieBrowserClient } from "@supabase/ssr";

/**
 * Browser-side client. Only the login button uses it — every data read happens
 * server-side. It writes the session cookies the server then reads.
 */
export function createBrowserClient() {
  return createCookieBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

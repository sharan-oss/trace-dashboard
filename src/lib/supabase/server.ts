import { createServerClient as createCookieClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export { createClientWithJwt } from "@/lib/supabase/jwt-client";

/**
 * The visitor's own RLS-scoped client, built from their session cookie. Every
 * page goes through here, so the identity is a property of the request rather
 * than of the server process (which is what Phase 0's dev stub made it).
 */
export async function createServerClient() {
  const cookieStore = await cookies();
  return createCookieClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components may not write cookies. Harmless: src/proxy.ts
            // refreshes the session on every request, so the browser still
            // gets the rotated token.
          }
        },
      },
    }
  );
}

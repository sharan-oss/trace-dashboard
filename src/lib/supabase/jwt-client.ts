import { createClient } from "@supabase/supabase-js";

/**
 * Publishable-key client carrying an explicit JWT, for callers that hold a
 * token but have no cookies: the Meta sync's machine identity, and the test
 * suite.
 *
 * Kept apart from ./server so those callers never import next/headers, which
 * only resolves inside a Next request.
 */
export function createClientWithJwt(jwt?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    jwt
      ? { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      : undefined
  );
}

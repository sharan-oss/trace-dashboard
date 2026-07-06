import { createClient } from "@supabase/supabase-js";
import { getDevJwt } from "@/lib/auth/dev-identity";

export function createClientWithJwt(jwt?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    jwt
      ? { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      : undefined
  );
}

export function createServerClient() {
  return createClientWithJwt(getDevJwt());
}

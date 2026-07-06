/**
 * Phase 0 admin-bypass stub. There is no real login yet — this reads a
 * pre-minted test JWT (see scripts/mint-dev-jwt.ts) selected by env var, so
 * RLS policies are exercised for real instead of bypassed. Phase 2 replaces
 * this with actual Supabase Auth; nothing downstream should import this file
 * once real sessions exist.
 */
export function getDevJwt(): string | undefined {
  if (process.env.DEV_ROLE === "admin") {
    return process.env.DEV_ADMIN_JWT || undefined;
  }
  if (process.env.DEV_CLIENT_ID) {
    return process.env.DEV_CLIENT_JWT || undefined;
  }
  return undefined;
}

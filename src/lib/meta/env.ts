/**
 * Server-only Meta configuration.
 *
 * The token is deliberately an environment variable rather than Supabase
 * Vault: reading Vault needs privileges forbidden inside a request handler,
 * and the only way to reach it under publishable-key + RLS would be a
 * SECURITY DEFINER function, which would make the token readable over
 * PostgREST by any admin browser session. An env var is never reachable by the
 * client SDK at all.
 *
 * META_BUSINESS_ID is optional: account discovery goes through
 * /me/assigned_ad_accounts (system-user tokens cannot traverse business
 * edges). META_APP_SECRET is optional but recommended — when present every
 * Graph call carries appsecret_proof.
 */
export type MetaConfig = {
  token: string;
  apiVersion: string;
  appSecret?: string;
  businessId?: string;
};

export function getMetaConfig(): MetaConfig {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const apiVersion = process.env.META_API_VERSION;

  const missing = [
    !token && "META_SYSTEM_USER_TOKEN",
    !apiVersion && "META_API_VERSION",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Meta configuration missing: ${missing.join(", ")}`);
  }

  return {
    token: token!,
    apiVersion: apiVersion!,
    appSecret: process.env.META_APP_SECRET || undefined,
    businessId: process.env.META_BUSINESS_ID || undefined,
  };
}

import type { ClientRow } from "@/lib/queries/overview";

/**
 * Which client the dashboard is looking at. Single-client view only — the
 * selection is a sticky preference in a cookie (Meta ad-account-picker
 * semantics), read server-side on every route.
 */

export const CLIENT_COOKIE = "trace_client_id";

export const DEFAULT_CLIENT_NAME = "Love School";

/**
 * Cookie match if it still points at a visible client, else Love School by
 * name (never a hardcoded id — a client-scoped login can't see Love School
 * and must fall through), else the first client. Null only when the caller
 * can see no clients at all.
 */
export function resolveSelectedClient(
  clients: ClientRow[],
  cookieValue: string | undefined,
): ClientRow | null {
  if (clients.length === 0) return null;
  return (
    clients.find((c) => c.id === cookieValue) ??
    clients.find((c) => c.name === DEFAULT_CLIENT_NAME) ??
    clients[0]
  );
}

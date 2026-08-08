import type { SupabaseClient } from "@supabase/supabase-js";
import { getDevJwt } from "@/lib/auth/dev-identity";
import { createClientWithJwt } from "@/lib/supabase/server";

/** Supabase client carrying the admin JWT (is_admin claim) — sees every client's rows. */
export async function adminClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getDevJwt("admin"));
}

/** Supabase client carrying the test-client JWT (client_id claim) — sees one client's rows. */
export async function clientClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getDevJwt("client"));
}

/** Exact row count for a table or view under the given client, failing loudly on error. */
export async function countRows(
  supabase: SupabaseClient,
  relation: string
): Promise<number> {
  const { count, error } = await supabase
    .from(relation)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${relation}) failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Asserts two relations hold the same number of rows.
 *
 * The database is live and rows arrive during the test run, so two sequential
 * counts can legitimately disagree by a row or two. Retrying preserves an exact
 * equality assertion — a view that genuinely drops rows fails every attempt,
 * while a concurrent insert is shaken off — which a fuzzy tolerance would not.
 */
export async function expectStableEqualCounts(
  supabase: SupabaseClient,
  relationA: string,
  relationB: string,
  attempts = 3
): Promise<void> {
  let last: [number, number] = [0, 0];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const a = await countRows(supabase, relationA);
    const b = await countRows(supabase, relationB);
    if (a === b) return;
    last = [a, b];
  }
  throw new Error(
    `counts still differ after ${attempts} attempts: ${relationA}=${last[0]}, ${relationB}=${last[1]}`
  );
}

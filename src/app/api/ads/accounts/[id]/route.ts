/**
 * DELETE disconnects a mapped ad account. It flips status to 'disconnected'
 * and NEVER deletes the row — history is retained so past ROAS never changes
 * (AC-7). The table has no delete policy, so a delete could not succeed anyway.
 */
import { requireAdmin } from "@/lib/auth/api-guard";
import { createSyncClient } from "@/lib/auth/service-identity";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const db = await createSyncClient();
  const { data, error } = await db
    .from("ad_accounts")
    .update({ status: "disconnected" })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "No such mapping" }, { status: 404 });
  }
  return Response.json({ disconnected: data.id });
}

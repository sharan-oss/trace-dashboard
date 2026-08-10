/**
 * The dedicated machine identity for the Meta ads sync — separate from the
 * Phase 0 dev-identity stub, which is slated for deletion in Phase 2.
 */
import { describe, expect, it } from "vitest";
import { createSyncClient, getSyncJwt } from "@/lib/auth/service-identity";

function decodeClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("sync service identity", () => {
  it("returns a JWT carrying the is_admin claim", async () => {
    const claims = decodeClaims(await getSyncJwt());
    expect(claims.is_admin).toBe(true);
  });

  it("caches the token across calls rather than signing in every time", async () => {
    const [first, second] = [await getSyncJwt(), await getSyncJwt()];
    expect(first).toBe(second);
  });

  it("can write where a client identity cannot", async () => {
    const supabase = await createSyncClient();
    const { data, error } = await supabase
      .from("ad_sync_runs")
      .insert({ kind: "manual", status: "running" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    await supabase.from("ad_sync_runs").delete().eq("id", data!.id);
  });
});

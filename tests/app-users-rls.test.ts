import { afterAll, describe, expect, it } from "vitest";
import { adminClient, clientClient, getTestJwt } from "./helpers/supabase";

/**
 * The permission matrix lives in app_users' RLS policies, so this is where it
 * gets proven — through real RLS-scoped JWTs, never the SQL editor (which
 * bypasses RLS entirely).
 *
 * The admin test identity stands in for a team member: is_admin without
 * is_super. Every row it creates is cleaned up afterwards; the addresses are
 * @trace.local, which no Google account can ever hold.
 */

const ADMIN_EMAIL = "dashboard-admin-test@trace.local";
const created: string[] = [];

function testEmail(): string {
  return `rls-test-${crypto.randomUUID()}@trace.local`;
}

function claimsOf(jwt: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

afterAll(async () => {
  if (created.length === 0) return;
  const admin = await adminClient();
  await admin.from("app_users").delete().in("email", created);
});

describe("custom access token hook", () => {
  it("still emits the app_metadata claims, and no is_super", async () => {
    const claims = claimsOf(await getTestJwt("admin"));
    expect(claims.is_admin).toBe(true);
    expect(claims.is_super).toBeUndefined();
    expect(claims.email).toBe(ADMIN_EMAIL);
  });

  it("gives the client identity a client_id and no admin rights", async () => {
    const claims = claimsOf(await getTestJwt("client"));
    expect(typeof claims.client_id).toBe("string");
    expect(claims.is_admin).toBeUndefined();
  });
});

describe("app_users RLS", () => {
  it("hides the table entirely from a client identity", async () => {
    const client = await clientClient();
    const { data, error } = await client.from("app_users").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("shows a team member only the rows they added", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from("app_users").select("invited_by");
    expect(error).toBeNull();
    // The seeded super-admin rows were invited by Sharan, not by this identity,
    // so an is_admin-without-is_super caller must not see them.
    for (const row of data ?? []) {
      expect(row.invited_by).toBe(ADMIN_EMAIL);
    }
  });

  it("lets a team member add a client user, then see and remove it", async () => {
    const admin = await adminClient();
    const { data: clients } = await admin.from("clients").select("id").limit(1);
    const clientId = clients?.[0]?.id as string;
    expect(clientId).toBeTruthy();

    const email = testEmail();
    created.push(email);

    const { error: insertError } = await admin.from("app_users").insert({
      email,
      role: "client",
      client_id: clientId,
      invited_by: ADMIN_EMAIL,
    });
    expect(insertError).toBeNull();

    const { data: visible } = await admin
      .from("app_users")
      .select("id, email, client_id")
      .eq("email", email);
    expect(visible).toHaveLength(1);
    expect(visible![0].client_id).toBe(clientId);

    await admin.from("app_users").delete().eq("email", email);
    const { data: afterDelete } = await admin
      .from("app_users")
      .select("id")
      .eq("email", email);
    expect(afterDelete).toEqual([]);
  });

  it("refuses an insert that attributes the row to someone else", async () => {
    const admin = await adminClient();
    const { data: clients } = await admin.from("clients").select("id").limit(1);
    const email = testEmail();
    created.push(email);

    const { error } = await admin.from("app_users").insert({
      email,
      role: "client",
      client_id: clients?.[0]?.id as string,
      invited_by: "someone-else@alttredmiinds.com",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/row-level security/i);
  });

  it("refuses a non-super identity minting a super admin", async () => {
    const admin = await adminClient();
    const email = testEmail();
    created.push(email);

    const { error } = await admin.from("app_users").insert({
      email,
      role: "super_admin",
      invited_by: ADMIN_EMAIL,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/row-level security/i);
  });

  it("refuses a client identity adding anyone", async () => {
    const client = await clientClient();
    const email = testEmail();
    created.push(email);

    const { error } = await client.from("app_users").insert({
      email,
      role: "client",
      client_id: crypto.randomUUID(),
      invited_by: "dashboard-client-test@trace.local",
    });
    expect(error).not.toBeNull();
  });

  it("scopes delete to the caller's own rows", async () => {
    const admin = await adminClient();
    const { data: clients } = await admin.from("clients").select("id").limit(1);
    const email = testEmail();
    created.push(email);

    await admin.from("app_users").insert({
      email,
      role: "client",
      client_id: clients?.[0]?.id as string,
      invited_by: ADMIN_EMAIL,
    });

    // A delete whose predicate steps outside the caller's own rows matches no
    // policy, so it removes nothing rather than erroring — the row survives.
    const client = await clientClient();
    await client.from("app_users").delete().eq("email", email);

    const { data: survivors } = await admin
      .from("app_users")
      .select("id")
      .eq("email", email);
    expect(survivors).toHaveLength(1);

    await admin.from("app_users").delete().eq("email", email);
  });
});

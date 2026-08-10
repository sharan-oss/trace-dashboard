/**
 * Slice B sync tables: existence, read RLS, and — the point — the WITH CHECK
 * write policies. A client identity must be refused every write; the admin
 * identity must succeed. Live DB, so every created row is cleaned up.
 *
 * The sync log is ad_sync_runs, NOT sync_runs — that name belongs to the
 * Razorpay L2 sync log (different shape, different job; see STATUS.md).
 */
import { afterAll, describe, expect, it } from "vitest";
import { adminClient, clientClient } from "./helpers/supabase";

const TABLES = ["ad_accounts", "ad_insights_daily", "ad_sync_runs"] as const;
const createdRunIds: string[] = [];

afterAll(async () => {
  if (createdRunIds.length === 0) return;
  const admin = await adminClient();
  await admin.from("ad_sync_runs").delete().in("id", createdRunIds);
});

describe("ads sync tables — existence and read RLS", () => {
  it.each(TABLES)("%s is readable by admin", async (table) => {
    const admin = await adminClient();
    // A real (non-HEAD) select: PostgREST reports a missing relation here,
    // where a head-only count quietly returns no error.
    const { error } = await admin.from(table).select("id").limit(1);
    expect(error).toBeNull();
  });

  it.each(TABLES)("%s is readable by a client identity without error", async (table) => {
    const client = await clientClient();
    const { error } = await client.from(table).select("id").limit(1);
    expect(error).toBeNull();
  });
});

describe("ads sync tables — write RLS (the WITH CHECK policies)", () => {
  it("lets the admin identity insert an ad_sync_runs row", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from("ad_sync_runs")
      .insert({ kind: "manual", status: "running" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    createdRunIds.push(data!.id);
  });

  it("refuses a client identity insert into ad_sync_runs", async () => {
    const client = await clientClient();
    const { data, error } = await client
      .from("ad_sync_runs")
      .insert({ kind: "manual", status: "running" })
      .select("id");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("refuses a client identity insert into ad_accounts", async () => {
    const client = await clientClient();
    const { error } = await client.from("ad_accounts").insert({
      client_id: "00000000-0000-0000-0000-000000000000",
      meta_ad_account_id: "act_test_should_not_insert",
      name: "nope",
      currency: "INR",
      timezone_name: "Asia/Kolkata",
    });
    expect(error).not.toBeNull();
  });
});

describe("ads sync tables — constraints", () => {
  it("rejects an ad_sync_runs row with an unknown kind", async () => {
    const admin = await adminClient();
    const { error } = await admin
      .from("ad_sync_runs")
      .insert({ kind: "not_a_real_kind", status: "running" });
    expect(error).not.toBeNull();
  });

  it("rejects an ad_sync_runs row with an unknown status", async () => {
    const admin = await adminClient();
    const { error } = await admin
      .from("ad_sync_runs")
      .insert({ kind: "manual", status: "not_a_real_status" });
    expect(error).not.toBeNull();
  });
});

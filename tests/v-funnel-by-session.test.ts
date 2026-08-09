import { describe, expect, it } from "vitest";
import {
  adminClient,
  clientClient,
  countRows,
  expectStableEqualCounts,
} from "./helpers/supabase";

const VIEW = "v_funnel_by_session";

const STAGES = [
  "reached_page_load",
  "reached_form_open",
  "reached_form_start",
  "reached_form_submit",
  "reached_payment_open",
  "reached_payment_complete",
] as const;

describe(`${VIEW} — monotonic funnel`, () => {
  it("returns exactly one row per session, including sessions with no events", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "sessions");
  });

  it("never lets a later stage be reached without every earlier one", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select(STAGES.join(",")).limit(3000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data! as unknown as Record<string, boolean>[]) {
      for (let i = 1; i < STAGES.length; i++) {
        if (row[STAGES[i]]) expect(row[STAGES[i - 1]]).toBe(true);
      }
    }
  });

  it("counts each stage at or below the stage before it", async () => {
    const admin = await adminClient();
    const counts: number[] = [];
    for (const stage of STAGES) {
      const { count, error } = await admin
        .from(VIEW)
        .select("*", { count: "exact", head: true })
        .eq(stage, true);
      if (error) throw new Error(error.message);
      counts.push(count ?? 0);
    }
    expect(counts[0]).toBeGreaterThan(0);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it("includes sessions that fired no events at all, with every stage false", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .eq("reached_page_load", false);
    if (error) throw new Error(error.message);
    expect(count).toBeGreaterThan(0);
  });
});

describe(`${VIEW} — RLS (AC-6)`, () => {
  it("scopes the client identity strictly below admin", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, VIEW),
      countRows(client, VIEW),
    ]);
    expect(clientCount).toBeGreaterThan(0);
    expect(clientCount).toBeLessThan(adminCount);
  });
});

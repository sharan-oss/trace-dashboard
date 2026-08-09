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

  // Nothing above ties the six reached_* stages to the actual event stream --
  // every assertion so far (monotonicity, count-ordering, event-less
  // sessions) holds trivially even if all six columns were collapsed into
  // one "did this session fire any event" expression, since equal stages are
  // trivially monotonic and trivially non-increasing. This test pins
  // reached_form_open specifically to the real events table: the count of
  // rows the view marks as having reached form_open (or any later stage)
  // must equal the count of distinct sessions that actually fired an event
  // at form_open or later. A view that stopped distinguishing stages would
  // still pass every other test in this file but would fail this one the
  // moment live data (which does distinguish stages) disagrees.
  it("ties reached_form_open to sessions with a real form_open-or-later event", async () => {
    const admin = await adminClient();

    const { count: reachedFormOpen, error: viewError } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .eq("reached_form_open", true);
    if (viewError) throw new Error(viewError.message);

    // PostgREST caps a single page well below the live row count for this
    // filter, so a plain `.limit()` silently truncates and undercounts.
    // Page through with `.range()` until a short page proves exhaustion.
    const distinctSessionIds = new Set<string>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await admin
        .from("events")
        .select("session_id")
        .in("event_type", [
          "form_open",
          "form_start",
          "form_submit",
          "payment_open",
          "payment_complete",
        ])
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      for (const row of data!) distinctSessionIds.add(row.session_id as string);
      if (data!.length < pageSize) break;
    }
    expect(distinctSessionIds.size).toBeGreaterThan(0);

    expect(reachedFormOpen).toBe(distinctSessionIds.size);
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

import { describe, expect, it } from "vitest";
import {
  adminClient,
  clientClient,
  countRows,
  expectStableEqualCounts,
} from "./helpers/supabase";

const VIEW = "v_payments_attributed";

describe(`${VIEW} — shape and safety`, () => {
  it("returns exactly one row per payment, adding and dropping none", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "payments");
  });

  it("never exposes an encrypted secret column", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("*").limit(1).single();
    if (error) throw new Error(error.message);
    for (const column of Object.keys(data)) expect(column).not.toMatch(/_enc$/);
  });

  it("exposes every base payments column alongside the derived ones", async () => {
    const admin = await adminClient();
    const [viewRow, tableRow] = await Promise.all([
      admin.from(VIEW).select("*").limit(1).single(),
      admin.from("payments").select("*").limit(1).single(),
    ]);
    if (viewRow.error) throw new Error(viewRow.error.message);
    if (tableRow.error) throw new Error(tableRow.error.message);
    for (const column of Object.keys(tableRow.data)) {
      expect(Object.keys(viewRow.data)).toContain(column);
    }
  });

  it("sets day_ist on every row", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .is("day_ist", null);
    if (error) throw new Error(error.message);
    expect(count).toBe(0);
  });
});

describe(`${VIEW} — payment rules (AC-2)`, () => {
  // Count-based rather than a per-row loop over a capped page: is_test_payment
  // is a total function of amount over two mutually exclusive, exhaustive
  // buckets (amount <= 500 vs amount > 500), so asserting each direction's
  // mismatch count is 0 covers every row server-side, however many payments
  // exist -- it can't silently stop covering the tail the way a `.limit(N)`
  // page + JS loop would once the table grows past N.
  it("marks a payment at or below 500 paise as a test payment, with no exception either way", async () => {
    const admin = await adminClient();

    const { count: falseNegatives, error: fnError } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .lte("amount", 500)
      .eq("is_test_payment", false);
    if (fnError) throw new Error(fnError.message);
    expect(falseNegatives).toBe(0);

    const { count: falsePositives, error: fpError } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .gt("amount", 500)
      .eq("is_test_payment", true);
    if (fpError) throw new Error(fpError.message);
    expect(falsePositives).toBe(0);
  });

  it("keeps test rows visible rather than filtering them", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .eq("is_test_payment", true);
    if (error) throw new Error(error.message);
    expect(count).toBeGreaterThan(0);
  });

  // Same count-based shape as is_test_payment above. is_paid is
  // `status = 'paid' OR paid_at IS NOT NULL`; checking both directions of
  // that OR server-side (rather than looping a capped page in JS) proves the
  // full equivalence over every row, not just the first page.
  it("treats a paid status with a null paid_at as paid, with no exception either way", async () => {
    const admin = await adminClient();

    const { count: paidStatusNotFlagged, error: e1 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .eq("status", "paid")
      .eq("is_paid", false);
    if (e1) throw new Error(e1.message);
    expect(paidStatusNotFlagged).toBe(0);

    const { count: paidAtNotFlagged, error: e2 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .not("paid_at", "is", null)
      .eq("is_paid", false);
    if (e2) throw new Error(e2.message);
    expect(paidAtNotFlagged).toBe(0);

    const { count: flaggedWithNeither, error: e3 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .eq("is_paid", true)
      .neq("status", "paid")
      .is("paid_at", null);
    if (e3) throw new Error(e3.message);
    expect(flaggedWithNeither).toBe(0);
  });

  it("leaves no utm_source_clean carrying the leaked prefix", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("utm_source_clean")
      .not("utm_source_clean", "is", null)
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.utm_source_clean.startsWith("utm_source=")).toBe(false);
    }
  });

  // IMPORTANT 2 (task-5 review): the previous version of this test only
  // asserted that exactly one is_test_client value appeared across all
  // payments -- true today because the sole rzp_test client has zero
  // payments, but a check that would pass unchanged if the clients join
  // were deleted (both give a single, constant value) or if starts_with
  // were inverted to '!starts_with' (still a single constant value, just
  // the other one). This version recomputes the expected value per
  // client_id from clients.razorpay_key_id directly and checks every row
  // against its own client's expected value, so it does catch an inverted
  // or otherwise wrong predicate.
  //
  // LIMITATION, stated explicitly: it does NOT catch the join being deleted
  // outright. With today's data every client's expected value is `false`
  // (the one rzp_test client has never taken a payment), so
  // `coalesce(..., false)` on a dropped join produces the same all-false
  // result as a correctly wired join would. This test closes for real the
  // first time a test-key client takes a payment -- until then, coverage
  // for "the join exists at all" rests on IMPORTANT 3's structural check
  // below, not on this test.
  it("derives is_test_client from each row's own client, not a single constant", async () => {
    const admin = await adminClient();

    const { data: clients, error: clientsError } = await admin
      .from("clients")
      .select("id, razorpay_key_id");
    if (clientsError) throw new Error(clientsError.message);
    expect(clients!.length).toBeGreaterThan(0);

    const expectedByClient = new Map<string, boolean>(
      clients!.map((c) => [c.id, Boolean(c.razorpay_key_id?.startsWith("rzp_test"))])
    );

    const { data: rows, error } = await admin
      .from(VIEW)
      .select("client_id, is_test_client")
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(rows!.length).toBeGreaterThan(0);

    for (const row of rows!) {
      expect(row.is_test_client).toBe(expectedByClient.get(row.client_id) ?? false);
    }
  });
});

describe(`${VIEW} — three-tier attribution`, () => {
  it("classifies every row as ad_id, ad_name or none, with the key agreeing", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("ad_key, ad_key_type").limit(1000);
    if (error) throw new Error(error.message);
    for (const row of data!) {
      expect(["ad_id", "ad_name", "none"]).toContain(row.ad_key_type);
      if (row.ad_key_type === "none") expect(row.ad_key).toBeNull();
      else expect(row.ad_key).not.toBeNull();
    }
  });

  it("prefers the stored id over extraction", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_id, ad_key, ad_key_type")
      .not("ad_id", "is", null)
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.ad_key).toBe(row.ad_id);
      expect(row.ad_key_type).toBe("ad_id");
    }
  });

  it("resolves ad keys by extraction for a client with no stored ids", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key")
      .is("ad_id", null)
      .eq("ad_key_type", "ad_id")
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  // MINOR 4 (task-5 review): rewritten from a `.limit(1000)` page + JS loop
  // to four server-side counts. ad_key / adset_key / campaign_key null-ness
  // partitions every row into exactly one of four mutually exclusive,
  // jointly exhaustive buckets (has ad_key; no ad_key but has adset_key; no
  // ad_key or adset_key but has campaign_key; none of the three) -- so
  // asserting each bucket's mismatch count is 0 fully proves the ladder over
  // every row in the table, not just the first page, and coverage can't
  // silently shrink as the table grows past a hardcoded limit.
  it("assigns the most specific tier that resolved", async () => {
    const admin = await adminClient();

    const { count: adMismatch, error: e1 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .not("ad_key", "is", null)
      .neq("attribution_tier", "ad");
    if (e1) throw new Error(e1.message);
    expect(adMismatch).toBe(0);

    const { count: adsetMismatch, error: e2 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .is("ad_key", null)
      .not("adset_key", "is", null)
      .neq("attribution_tier", "adset");
    if (e2) throw new Error(e2.message);
    expect(adsetMismatch).toBe(0);

    const { count: campaignMismatch, error: e3 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .is("ad_key", null)
      .is("adset_key", null)
      .not("campaign_key", "is", null)
      .neq("attribution_tier", "campaign");
    if (e3) throw new Error(e3.message);
    expect(campaignMismatch).toBe(0);

    const { count: noneMismatch, error: e4 } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .is("ad_key", null)
      .is("adset_key", null)
      .is("campaign_key", null)
      .neq("attribution_tier", "none");
    if (e4) throw new Error(e4.message);
    expect(noneMismatch).toBe(0);
  });

  // IMPORTANT 1 (task-5 review): replaces "leaves payments with no session
  // unattributed at every tier", whose only assertion was `data.length > 0`
  // -- true for any implementation, including one that nulls out
  // attribution entirely. That test's premise was also wrong: payments
  // resolve from their OWN utm_params, independent of any session, so a
  // null session_id does not imply "unattributable". Verified directly:
  // of the 16 payments with session_id null, 9 resolve at the ad tier and
  // only 7 land at none. This version asserts the real invariant -- that
  // attribution for these rows comes from the payment's own utm_params, not
  // through a session -- and goes red the moment the view starts routing
  // attribution through `sessions` (payments have no FK columns overlapping
  // with sessions.landing_url extraction, so this could only happen through
  // an accidental future rewrite).
  it("attributes payments from their own utm_params even with no session", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("session_id, ad_key, adset_key, campaign_key, attribution_tier")
      .is("session_id", null);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);

    const resolvedAtAdTier = data!.filter(
      (row) => row.attribution_tier === "ad" && row.ad_key !== null
    );
    expect(resolvedAtAdTier.length).toBeGreaterThan(0);

    for (const row of data!) {
      const expected =
        row.ad_key !== null
          ? "ad"
          : row.adset_key !== null
            ? "adset"
            : row.campaign_key !== null
              ? "campaign"
              : "none";
      expect(row.attribution_tier).toBe(expected);
    }
  });
});

// IMPORTANT 3 (task-5 review): none of the tests above can prove
// v_payments_attributed actually joins public.v_ad_name_resolution, because
// ad_key_type = 'ad_name' matches zero live payment rows -- every test in
// this file would pass identically if that `left join` were deleted from
// the view. Task 4 already covers the shared rule's own correctness
// (ambiguity guard, cross-tenant guard); what's missing here is proof that
// THIS view still wires it in. A structural check on the view's own
// definition (via the debug_v_payments_attributed_definition() probe added
// alongside this fix, see migration 20260809140400) closes that gap without
// depending on live data ever landing in that tier.
describe(`${VIEW} — shared join wiring (structural)`, () => {
  it("still joins public.v_ad_name_resolution in its view definition", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.rpc("debug_v_payments_attributed_definition");
    if (error) throw new Error(error.message);
    expect(data).toContain("v_ad_name_resolution");
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

  it("returns exactly one client_id to the client identity", async () => {
    const client = await clientClient();
    const { data, error } = await client.from(VIEW).select("client_id").limit(2000);
    if (error) throw new Error(error.message);
    expect(new Set(data!.map((r) => r.client_id)).size).toBe(1);
  });

  it("never leaks another client's is_test_client signal", async () => {
    const client = await clientClient();
    const { data, error } = await client.from(VIEW).select("is_test_client").limit(500);
    if (error) throw new Error(error.message);
    expect(new Set(data!.map((r) => r.is_test_client)).size).toBe(1);
  });
});

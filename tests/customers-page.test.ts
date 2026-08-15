/**
 * The People tab's read path (paged PostgREST reads of v_customers_attributed)
 * and the customer detail sheet's reads, against the live DB.
 *
 * The load-bearing invariant: the People page and the Value tab's RPCs apply
 * THE SAME cohort rule (first purchase in range) through two different
 * mechanisms — rangeStartDay() in TS versus the cutoff CTE in SQL. If they
 * ever drift, the two tabs disagree about who exists, so the equality is
 * asserted here for every preset.
 */
import { describe, expect, it } from "vitest";
import { adminClient, clientClient } from "./helpers/supabase";
import {
  getCustomerDetail,
  getCustomersKpis,
  getCustomersPage,
  getTopCustomers,
  PEOPLE_PAGE_SIZE,
  type PeoplePageOpts,
} from "@/lib/queries/customers";

const OTHER_CLIENT = "00000000-0000-0000-0000-000000000000";

const DEFAULTS: PeoplePageOpts = {
  sort: "ltv",
  dir: "desc",
  repeatOnly: false,
  page: 0,
};

async function loveSchoolId() {
  const admin = await adminClient();
  const { data, error } = await admin
    .from("clients")
    .select("id")
    .eq("name", "Love School")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function attemptStable(
  check: () => Promise<void>,
  attempts = 3,
): Promise<void> {
  for (let i = 1; ; i += 1) {
    try {
      await check();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
    }
  }
}

describe("getCustomersPage — cohort parity with the Value tab", () => {
  it("total matches customers_kpis for every preset (TS cutoff ≡ SQL cutoff)", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      for (const preset of ["7d", "30d", "all"] as const) {
        const [kpis, page] = await Promise.all([
          getCustomersKpis(admin, clientId, preset),
          getCustomersPage(admin, clientId, preset, DEFAULTS),
        ]);
        expect(page.total, `preset ${preset}`).toBe(kpis.cohort_customers);
      }
    });
  });

  it("pages are disjoint, full-sized, and ordered by LTV descending", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const [p0, p1] = await Promise.all([
      getCustomersPage(admin, clientId, "all", DEFAULTS),
      getCustomersPage(admin, clientId, "all", { ...DEFAULTS, page: 1 }),
    ]);
    expect(p0.rows).toHaveLength(PEOPLE_PAGE_SIZE);
    expect(p1.rows.length).toBeGreaterThan(0);

    const ids0 = new Set(p0.rows.map((r) => r.customer_id));
    expect(p1.rows.some((r) => ids0.has(r.customer_id))).toBe(false);

    const all = [...p0.rows, ...p1.rows];
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i - 1].lifetime_paise).toBeGreaterThanOrEqual(
        all[i].lifetime_paise,
      );
    }
  });

  it("repeatOnly returns exactly the repeaters", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [kpis, page] = await Promise.all([
        getCustomersKpis(admin, clientId, "all"),
        getCustomersPage(admin, clientId, "all", {
          ...DEFAULTS,
          repeatOnly: true,
        }),
      ]);
      expect(page.total).toBe(kpis.repeat_customers);
      expect(page.rows.every((r) => r.is_repeat)).toBe(true);
    });
  });

  it("finds a known customer by their exact name", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const [known] = await getTopCustomers(admin, clientId, "all", 1);
    expect(known).toBeDefined();
    expect(known.name.length).toBeGreaterThan(0);

    const page = await getCustomersPage(admin, clientId, "all", {
      ...DEFAULTS,
      search: known.name,
    });
    expect(page.rows.some((r) => r.customer_id === known.customer_id)).toBe(true);
  });

  it("or-syntax metacharacters in search cannot break the query", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    // Each would corrupt PostgREST's or() mini-language if passed through raw.
    for (const hostile of ["a,b.eq.x)", "((", "%,name.neq.", "*)"]) {
      const page = await getCustomersPage(admin, clientId, "all", {
        ...DEFAULTS,
        search: hostile,
      });
      // Sanitised to harmless text: the read succeeds (no throw) and returns a
      // well-formed page — possibly empty, never an error.
      expect(Array.isArray(page.rows)).toBe(true);
    }
  });

  it("fastest-to-upsell ascending puts real values first and nulls last", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const page = await getCustomersPage(admin, clientId, "all", {
      ...DEFAULTS,
      sort: "fastest",
      dir: "asc",
    });
    const days = page.rows.map((r) => r.days_to_second);
    const firstNull = days.findIndex((d) => d == null);
    const valued = (firstNull === -1 ? days : days.slice(0, firstNull)) as number[];
    expect(valued.length).toBeGreaterThan(0);
    for (let i = 1; i < valued.length; i += 1) {
      expect(valued[i]).toBeGreaterThanOrEqual(valued[i - 1]);
    }
    // Once nulls start, no value follows — "no second purchase" never wins a sort.
    if (firstNull !== -1) {
      expect(days.slice(firstNull).every((d) => d == null)).toBe(true);
    }
  });
});

describe("getCustomerDetail — the sheet's reads", () => {
  it("timeline is ascending and sums to the customer's lifetime value (oracle)", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const top = await getTopCustomers(admin, clientId, "all", 3);
    for (const customer of top) {
      const detail = await getCustomerDetail(admin, customer.customer_id);
      expect(detail).not.toBeNull();
      const summed = detail!.timeline.reduce((t, e) => t + e.amount, 0);
      expect(summed).toBe(customer.lifetime_paise);
      for (let i = 1; i < detail!.timeline.length; i += 1) {
        expect(
          new Date(detail!.timeline[i].paid_at).getTime(),
        ).toBeGreaterThanOrEqual(
          new Date(detail!.timeline[i - 1].paid_at).getTime(),
        );
      }
    }
  });

  it("an unknown customer id resolves to null, not an error", async () => {
    const admin = await adminClient();
    const detail = await getCustomerDetail(admin, OTHER_CLIENT);
    expect(detail).toBeNull();
  });

  it("a scoped client identity cannot read another tenant's customer", async () => {
    // The Phase 0 test-client identity IS Love School, so the cross-tenant
    // probe must use a customer belonging to someone else. Fetch one as admin
    // (Occultyogis has ~598), then assert the scoped identity gets null for
    // the very same id — RLS filtering the row away, not erroring.
    const admin = await adminClient();
    const client = await clientClient();
    const { data: other, error } = await admin
      .from("v_customers_attributed")
      .select("customer_id, client_id")
      .neq("client_id", "cb7daf9d-28f1-4699-a587-afb6e2ec44da")
      .limit(1)
      .single();
    expect(error).toBeNull();

    const asAdmin = await getCustomerDetail(admin, other!.customer_id as string);
    expect(asAdmin).not.toBeNull(); // admin proves the row exists...

    const asClient = await getCustomerDetail(client, other!.customer_id as string);
    expect(asClient).toBeNull(); // ...and the scoped identity cannot see it.
  });

  it("a scoped client identity sees an empty page for another tenant", async () => {
    const client = await clientClient();
    const page = await getCustomersPage(client, OTHER_CLIENT, "all", DEFAULTS);
    expect(page.total).toBe(0);
    expect(page.rows).toHaveLength(0);
  });
});

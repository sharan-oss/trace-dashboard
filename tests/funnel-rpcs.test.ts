/**
 * Funnel data layer against the live DB. The two invariant classes that make
 * the page trustworthy:
 *
 *  - MONOTONICITY: stages mean "reached this or beyond", so each count must be
 *    ≤ its predecessor — in the overview and in every segment of every lens.
 *    This is the property the raw event stream does NOT have (form_starts with
 *    no form_open exist), and the whole reason v_funnel_by_session exists.
 *  - RECONCILIATION: segments plus their null-key bucket sum to the overview,
 *    for every lens — the table and the stage card can never disagree.
 *
 * Relationship assertions with the attemptStable retry, never absolute counts:
 * rows arrive while the suite runs.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { adminClient, clientClient } from "./helpers/supabase";
import {
  getFunnelBreakdown,
  getFunnelOverview,
  type FunnelSegmentRow,
} from "@/lib/queries/funnel";
import { biggestLeak, FUNNEL_STAGES } from "@/lib/metrics/funnel-stages";

const OTHER_CLIENT = "00000000-0000-0000-0000-000000000000";

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

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

function expectMonotonic(row: Record<string, number>, label: string) {
  for (let i = 1; i < FUNNEL_STAGES.length; i += 1) {
    const prev = row[FUNNEL_STAGES[i - 1].key];
    const curr = row[FUNNEL_STAGES[i].key];
    expect(curr, `${label}: ${FUNNEL_STAGES[i].key} > ${FUNNEL_STAGES[i - 1].key}`)
      .toBeLessThanOrEqual(prev);
  }
}

describe("funnel_overview", () => {
  it("stages are monotonically non-increasing and bounded by sessions", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const o = await getFunnelOverview(admin, clientId, "all");
    expect(o.sessions).toBeGreaterThan(0);
    expect(o.reached_page_load).toBeLessThanOrEqual(o.sessions);
    expectMonotonic(o as unknown as Record<string, number>, "overview");
  });

  it("never_loaded is the exact complement of page_load", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const o = await getFunnelOverview(admin, clientId, "all");
    expect(o.never_loaded).toBe(o.sessions - o.reached_page_load);
  });

  it("no_telemetry_converted comes from data and is bounded by both parents", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const o = await getFunnelOverview(admin, clientId, "all");
    expect(o.no_telemetry_converted).toBeLessThanOrEqual(o.no_telemetry);
    expect(o.no_telemetry_converted).toBeLessThanOrEqual(o.reached_payment_complete);
  });

  it("widening the range never shrinks any count", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const [d7, d30, all] = await Promise.all([
        getFunnelOverview(admin, clientId, "7d"),
        getFunnelOverview(admin, clientId, "30d"),
        getFunnelOverview(admin, clientId, "all"),
      ]);
      expect(d30.sessions).toBeGreaterThanOrEqual(d7.sessions);
      expect(all.sessions).toBeGreaterThanOrEqual(d30.sessions);
      expect(all.reached_payment_complete).toBeGreaterThanOrEqual(
        d30.reached_payment_complete,
      );
    });
  });
});

describe("funnel_breakdown — reconciliation", () => {
  function sums(rows: FunnelSegmentRow[]) {
    return rows.reduce(
      (t, r) => ({
        sessions: t.sessions + r.sessions,
        paid: t.paid + r.reached_payment_complete,
        form: t.form + r.reached_form_open,
      }),
      { sessions: 0, paid: 0, form: 0 },
    );
  }

  it("every lens sums to the overview, bucket included, on every range", async () => {
    for (const lens of ["campaign", "page", "product"] as const) {
      for (const range of ["30d", "all"] as const) {
        await attemptStable(async () => {
          const admin = await adminClient();
          const clientId = await loveSchoolId();
          const [o, rows] = await Promise.all([
            getFunnelOverview(admin, clientId, range),
            getFunnelBreakdown(admin, clientId, range, lens),
          ]);
          const s = sums(rows);
          expect(s.sessions, `${lens}/${range}`).toBe(o.sessions);
          expect(s.paid, `${lens}/${range}`).toBe(o.reached_payment_complete);
          expect(s.form, `${lens}/${range}`).toBe(o.reached_form_open);
        });
      }
    }
  });

  it("every segment row is itself monotonic", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    for (const lens of ["campaign", "page", "product"] as const) {
      const rows = await getFunnelBreakdown(admin, clientId, "all", lens);
      for (const row of rows) {
        expectMonotonic(
          row as unknown as Record<string, number>,
          `${lens}:${row.segment_key}`,
        );
      }
    }
  });

  it("the ad drill sums to its campaign's own segment row", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const campaigns = await getFunnelBreakdown(admin, clientId, "all", "campaign");
      const target = campaigns.find((r) => r.segment_key != null);
      expect(target).toBeDefined();

      const ads = await getFunnelBreakdown(
        admin,
        clientId,
        "all",
        "ad",
        target!.segment_key as string,
      );
      const s = ads.reduce(
        (t, r) => ({
          sessions: t.sessions + r.sessions,
          paid: t.paid + r.reached_payment_complete,
        }),
        { sessions: 0, paid: 0 },
      );
      expect(s.sessions).toBe(target!.sessions);
      expect(s.paid).toBe(target!.reached_payment_complete);
    });
  });

  it("SDK-oracle: one campaign's session count vs the views directly", async () => {
    await attemptStable(async () => {
      const admin = await adminClient();
      const clientId = await loveSchoolId();
      const rows = await getFunnelBreakdown(admin, clientId, "all", "campaign");
      const target = rows.find((r) => r.segment_key != null);
      expect(target).toBeDefined();
      const { count, error } = await admin
        .from("v_sessions_attributed")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("campaign_key", target!.segment_key as string);
      expect(error).toBeNull();
      expect(target!.sessions).toBe(count ?? 0);
    });
  });

  it("refuses an unknown dimension and an ad drill without a campaign", async () => {
    const admin = await adminClient();
    const clientId = await loveSchoolId();
    const bad = await admin.rpc("funnel_breakdown", {
      p_client_id: clientId,
      p_days: null,
      p_dimension: "utm_source",
      p_campaign: null,
    });
    expect(bad.error).not.toBeNull();

    const noCampaign = await admin.rpc("funnel_breakdown", {
      p_client_id: clientId,
      p_days: null,
      p_dimension: "ad",
      p_campaign: null,
    });
    expect(noCampaign.error).not.toBeNull();
  });
});

describe("metric_normalize_landing_page", () => {
  it("strips protocol (any case), query, fragment; lowercases; collapses trailing slash", async () => {
    const admin = await adminClient();
    const cases: [string | null, string | null][] = [
      ["HTTPS://Workshop.Example.co.in/My-Page/?utm_source=x#frag", "workshop.example.co.in/my-page"],
      ["http://a.b/c", "a.b/c"],
      ["a.b/c/", "a.b/c"],
      ["", null],
      [null, null],
    ];
    for (const [input, expected] of cases) {
      const { data, error } = await admin.rpc("metric_normalize_landing_page", {
        p_url: input,
      });
      expect(error).toBeNull();
      expect(data, `input: ${input}`).toBe(expected);
    }
  });
});

describe("funnel — the biggest-leak callout (pure)", () => {
  it("finds the largest relative drop, page-load onward", () => {
    const leak = biggestLeak({
      reached_page_load: 9784,
      reached_form_open: 1132,
      reached_form_start: 1119,
      reached_form_submit: 822,
      reached_payment_open: 818,
      reached_payment_complete: 469,
    });
    expect(leak).not.toBeNull();
    expect(leak!.fromLabel).toBe("Page view");
    expect(leak!.lossVerb).toBe("open the form");
    expect(leak!.lostShare).toBeCloseTo(1 - 1132 / 9784, 5);
  });

  it("is null when nothing loaded or nothing drops", () => {
    const zero = {
      reached_page_load: 0,
      reached_form_open: 0,
      reached_form_start: 0,
      reached_form_submit: 0,
      reached_payment_open: 0,
      reached_payment_complete: 0,
    };
    expect(biggestLeak(zero)).toBeNull();
    expect(
      biggestLeak({ ...zero, reached_page_load: 5, reached_form_open: 5,
        reached_form_start: 5, reached_form_submit: 5,
        reached_payment_open: 5, reached_payment_complete: 5 }),
    ).toBeNull();
  });
});

describe("funnel — tenant scoping", () => {
  it("a scoped client identity sees zeros for another tenant", async () => {
    const client = await clientClient();
    const o = await getFunnelOverview(client, OTHER_CLIENT, "all");
    expect(o.sessions).toBe(0);
    const rows = await getFunnelBreakdown(client, OTHER_CLIENT, "all", "campaign");
    expect(rows.reduce((t, r) => t + r.sessions, 0)).toBe(0);
  });

  it("anon is refused by both RPCs and by the view after the revoke", async () => {
    const anon = anonClient();
    const clientId = await loveSchoolId();

    for (const fn of ["funnel_overview"]) {
      const { error } = await anon.rpc(fn, { p_client_id: clientId, p_days: null });
      expect(error, `${fn} must refuse anon`).not.toBeNull();
    }
    const breakdown = await anon.rpc("funnel_breakdown", {
      p_client_id: clientId,
      p_days: null,
      p_dimension: "campaign",
      p_campaign: null,
    });
    expect(breakdown.error).not.toBeNull();

    const { error: viewError } = await anon
      .from("v_funnel_by_session")
      .select("session_id")
      .limit(1);
    expect(viewError, "v_funnel_by_session must refuse anon").not.toBeNull();
  });
});

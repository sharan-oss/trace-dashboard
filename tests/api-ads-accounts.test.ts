/**
 * Account-mapping route handlers, invoked directly with a Request — no server
 * is started. Meta is always mocked; the database is the live one, so only
 * non-mutating paths and refused mutations are exercised here (the success
 * path is exercised by the live sync in Task 5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "@/lib/auth/session";

const listAdAccounts = vi.fn();

const ADMIN: Identity = {
  email: "team@alttredmiinds.com",
  isAdmin: true,
  isSuper: false,
  clientId: null,
};
// The handlers are called with a bare Request, so there is no request scope for
// cookies() to read. Only the session read is stubbed — requireAdmin's own
// logic still runs.
let identity: Identity | null = ADMIN;

vi.mock("@/lib/auth/session", () => ({
  getIdentity: async () => identity,
  hasAccess: (id: Identity) => id.isAdmin || id.clientId !== null,
}));

vi.mock("@/lib/meta/client", () => ({
  createMetaClient: () => ({ listAdAccounts, listAds: vi.fn(), getAdInsights: vi.fn() }),
  MetaApiError: class extends Error {},
}));

vi.mock("@/lib/meta/env", () => ({
  getMetaConfig: () => ({ token: "t", apiVersion: "v26.0" }),
}));

const CLIENT_ID = "cb7daf9d-28f1-4699-a587-afb6e2ec44da"; // Love School

async function importRoute() {
  return import("@/app/api/ads/accounts/route");
}

async function importDetailRoute() {
  return import("@/app/api/ads/accounts/[id]/route");
}

afterEach(() => {
  vi.clearAllMocks();
  identity = ADMIN;
});

describe("admin gate", () => {
  it("refuses a client user", async () => {
    identity = {
      email: "buyer@example.com",
      isAdmin: false,
      isSuper: false,
      clientId: CLIENT_ID,
    };
    const { GET } = await importRoute();
    expect((await GET()).status).toBe(403);
  });

  it("refuses a signed-out caller", async () => {
    identity = null;
    const { GET } = await importRoute();
    expect((await GET()).status).toBe(403);
  });
});

describe("GET /api/ads/accounts", () => {
  it("returns the accounts the System User can see plus current mappings", async () => {
    listAdAccounts.mockResolvedValue([
      { id: "act_1", account_id: "1", name: "Love School Ads", currency: "INR", timezone_name: "Asia/Kolkata" },
    ]);
    const { GET } = await importRoute();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toHaveLength(1);
    expect(Array.isArray(body.mappings)).toBe(true);
  });

  it("returns 502 when Meta is unreachable", async () => {
    listAdAccounts.mockRejectedValue(new Error("network down"));
    const { GET } = await importRoute();
    const response = await GET();
    expect(response.status).toBe(502);
  });
});

describe("POST /api/ads/accounts", () => {
  it("refuses an account whose currency is not INR", async () => {
    listAdAccounts.mockResolvedValue([
      { id: "act_usd", account_id: "9", name: "US Ads", currency: "USD", timezone_name: "America/New_York" },
    ]);
    const { POST } = await importRoute();
    const response = await POST(
      new Request("http://localhost/api/ads/accounts", {
        method: "POST",
        body: JSON.stringify({ client_id: CLIENT_ID, meta_ad_account_id: "act_usd" }),
      })
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/currency/i);
  });

  it("returns 422 for an account the System User cannot see", async () => {
    listAdAccounts.mockResolvedValue([]);
    const { POST } = await importRoute();
    const response = await POST(
      new Request("http://localhost/api/ads/accounts", {
        method: "POST",
        body: JSON.stringify({ client_id: CLIENT_ID, meta_ad_account_id: "act_unknown" }),
      })
    );
    expect(response.status).toBe(422);
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("http://localhost/api/ads/accounts", { method: "POST", body: JSON.stringify({}) })
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/ads/accounts/:id", () => {
  it("returns 404 for an unknown mapping", async () => {
    const { DELETE } = await importDetailRoute();
    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });
});

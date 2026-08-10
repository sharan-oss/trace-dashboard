/**
 * The Meta Graph client, tested entirely against an injected fetch — no live
 * call, no real delay. If a test hangs, a real fetch is leaking through; fix
 * the injection rather than adding a timeout.
 */
import { describe, expect, it, vi } from "vitest";
import { MetaApiError, createMetaClient } from "@/lib/meta/client";

const API_VERSION = "v26.0";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function makeClient(
  fetchImpl: typeof fetch,
  sleepImpl = vi.fn(async (_ms: number) => {}),
  appSecret?: string
) {
  return {
    client: createMetaClient({ token: "test-token", apiVersion: API_VERSION, fetchImpl, sleepImpl, appSecret }),
    sleepImpl,
  };
}

describe("createMetaClient — request shape", () => {
  it("targets the pinned API version and never 'latest'", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain(`/${API_VERSION}/`);
    expect(url).not.toContain("latest");
  });

  it("sends the token as a bearer header, never in the query string", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain("test-token");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
  });

  it("appends appsecret_proof when an app secret is configured", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, undefined, "shhh");
    await client.listAds("act_123");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("appsecret_proof=");
  });

  it("omits appsecret_proof when no app secret is configured", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("appsecret_proof");
  });

  it("requests paused and archived ads so retired ads still resolve", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("effective_status");
  });

  it("discovers accounts via me/assigned_ad_accounts, not business edges", async () => {
    // Proven live 2026-08-10: system-user tokens get "(#100) nonexisting
    // field" on /{business_id}/owned_ad_accounts and /client_ad_accounts.
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAdAccounts();

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("me/assigned_ad_accounts");
    expect(url).not.toContain("owned_ad_accounts");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createMetaClient — pagination", () => {
  it("follows paging.next until exhausted and returns every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "1", name: "one", status: "ACTIVE" }],
          paging: { next: "https://graph.facebook.com/next-page-2" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "2", name: "two", status: "ACTIVE" }],
          paging: { next: "https://graph.facebook.com/next-page-3" },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "3", name: "three", status: "ACTIVE" }] }));

    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    const ads = await client.listAds("act_123");

    expect(ads.map((a) => a.id)).toEqual(["1", "2", "3"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops at a single page when no next link is present", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [{ id: "1", name: "one", status: "ACTIVE" }] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createMetaClient — rate limiting and backoff", () => {
  it("retries with backoff on error code 17 and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "User request limit reached", code: 17 } }, { status: 400 })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "1", name: "one", status: "ACTIVE" }] }));

    const { client, sleepImpl } = makeClient(fetchImpl as unknown as typeof fetch);
    const ads = await client.listAds("act_123");

    expect(ads).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalled();
  });

  it("backs off increasingly rather than hammering at a fixed interval", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 17 } }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 17 } }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const { client, sleepImpl } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");

    const delays = sleepImpl.mock.calls.map((c) => c[0] as number);
    expect(delays.length).toBeGreaterThanOrEqual(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it("slows down when usage headers report above 80 percent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { data: [] },
        {
          headers: {
            "x-business-use-case-usage": JSON.stringify({
              "123": [{ type: "ads_insights", call_count: 92, total_cputime: 10, total_time: 12 }],
            }),
          },
        }
      )
    );
    const { client, sleepImpl } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");
    expect(sleepImpl).toHaveBeenCalled();
  });

  it("gives up after the retry budget and throws MetaApiError", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ error: { code: 17 } }, { status: 400 }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.listAds("act_123")).rejects.toBeInstanceOf(MetaApiError);
  });

  it("does not retry a non-rate-limit error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid parameter", code: 100 } }, { status: 400 })
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.listAds("act_123")).rejects.toBeInstanceOf(MetaApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createMetaClient — insights", () => {
  it("requests one row per ad per day", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.getAdInsights("act_123", "2026-08-01");

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("level=ad");
    expect(url).toContain("time_increment=1");
    expect(url).toContain("2026-08-01");
  });
});

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
  it("requests one row per ad per day across the given range", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.getAdInsights("act_123", "2026-08-01", "2026-08-03");

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("level=ad");
    expect(url).toContain("time_increment=1");
    expect(url).toContain("2026-08-01");
    expect(url).toContain("2026-08-03");
  });
});

describe("createMetaClient — oversized page recovery (code 1)", () => {
  /** Meta's "reduce the amount of data" refusal, which no amount of backoff fixes. */
  const tooMuch = { error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } };

  it("halves the page size and retries the same page until Meta accepts it", async () => {
    // Live shape (2026-08-17): a 2,540-ad account refuses the 720px creative
    // expansion at limit=100 AND at 50, but answers at 25. Without this the
    // whole sync dies on its first API call.
    const limits: number[] = [];
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const limit = Number(new URL(String(args[0])).searchParams.get("limit"));
      limits.push(limit);
      if (limit > 25) return jsonResponse(tooMuch, { status: 400 });
      return jsonResponse({ data: [{ id: "1" }, { id: "2" }] });
    });
    const { client, sleepImpl } = makeClient(fetchImpl as unknown as typeof fetch);

    const ads = await client.listAds("act_123");

    // Asserted as a property, not fixed numbers: the starting page size is a
    // tuning decision that changes, the halving-until-accepted is the contract.
    expect(limits.length).toBeGreaterThan(1);
    for (let i = 1; i < limits.length; i += 1) {
      expect(limits[i]).toBe(Math.max(10, Math.floor(limits[i - 1] / 2)));
    }
    expect(limits.at(-1)).toBeLessThanOrEqual(25);
    expect(limits.slice(0, -1).every((l) => l > 25)).toBe(true);
    expect(ads).toHaveLength(2);
    // Not a rate limit — sleeping would waste time and fix nothing.
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("keeps the reduced page size across the rest of the walk", async () => {
    // Meta echoes the limit into its own paging.next, so the second page must
    // not silently jump back to 100 and fail again.
    const limits: number[] = [];
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      const limit = Number(url.searchParams.get("limit"));
      limits.push(limit);
      if (limit > 50) return jsonResponse(tooMuch, { status: 400 });
      if (url.searchParams.get("after") == null) {
        url.searchParams.set("after", "cursor2");
        return jsonResponse({ data: [{ id: "1" }], paging: { next: url.toString() } });
      }
      return jsonResponse({ data: [{ id: "2" }] });
    });
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const ads = await client.listAds("act_123");

    // The last two calls are page 1 (accepted) and page 2 — page 2 must reuse
    // the reduced size, not jump back to the original and fail again.
    expect(ads.map((a) => a.id)).toEqual(["1", "2"]);
    expect(limits.at(-1)).toBe(limits.at(-2));
    expect(limits.at(-1)).toBeLessThanOrEqual(50);
  });

  it("gives up rather than looping forever when even the smallest page is refused", async () => {
    // A permanently broken query must surface as an error on the run log, not
    // spin the sync until the request times out.
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(tooMuch, { status: 400 }),
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.listAds("act_123")).rejects.toBeInstanceOf(MetaApiError);
    // Halves to the floor of 10 and then stops, rather than retrying forever.
    const tried = fetchImpl.mock.calls.map((c) =>
      Number(new URL(String(c[0])).searchParams.get("limit")),
    );
    expect(tried.length).toBeGreaterThan(0);
    expect(tried.at(-1)).toBe(10);
    expect(new Set(tried).size).toBe(tried.length);
    expect(tried.length).toBeLessThan(12);
  });

  it("does not confuse an unrelated error for an oversized page", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Cannot request deleted objects", code: 100, error_subcode: 1815001 } }, { status: 400 })
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.listAds("act_123")).rejects.toMatchObject({ code: 100 });
    expect(fetchImpl.mock.calls.length).toBe(1);
  });
});

describe("createMetaClient — score governor", () => {
  /**
   * Meta's ad-account API-level score limiter publishes NO usage header, so
   * the only way to respect it is to model it. Dev tier: 60 points per 300s,
   * 1 point per read. These tests pin the pacing so a large account cannot
   * silently earn a 300s block the way the first Occultyogis backfill did.
   */
  it("paces itself below the tier budget instead of sprinting into a block", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    // 60 calls fit the budget exactly; the 61st must wait rather than be sent
    // straight into the limiter.
    for (let i = 0; i < 60; i += 1) await client.listAdAccounts();
    expect(sleepImpl).not.toHaveBeenCalled();

    await client.listAdAccounts();
    expect(sleepImpl).toHaveBeenCalled();
  });

  it("waits the documented block duration on a score-limit error, not a short backoff", async () => {
    // Subcode 2446079 is a fixed 300s block. Backing off 500ms and retrying
    // inside it burns the retry budget and, per Meta, extends the block.
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { message: "User request limit reached", code: 17, error_subcode: 2446079 } },
          { status: 400 },
        );
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await client.listAdAccounts();

    expect(sleepImpl).toHaveBeenCalledWith(300_000);
  });

  it("still uses short backoff for an ordinary rate-limit code", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: { message: "slow down", code: 613 } }, { status: 400 });
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await client.listAdAccounts();

    expect(sleepImpl).toHaveBeenCalledWith(500);
  });

  it("honours a raised budget so Full access is one config change", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const client = createMetaClient({
      token: "t",
      apiVersion: API_VERSION,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
      maxScore: 9000,
    });

    for (let i = 0; i < 200; i += 1) await client.listAdAccounts();
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});

describe("createMetaClient — honours Meta's own recovery estimate", () => {
  it("waits estimated_time_to_regain_access rather than a guessed duration", async () => {
    // The business-use-case buckets (code 80004) DO advertise a recovery time,
    // in minutes. Guessing shorter earns a longer block; guessing longer
    // wastes a backfill window.
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { message: "too many calls to this ad-account", code: 80004, error_subcode: 2446079 } },
          {
            status: 400,
            headers: {
              "x-business-use-case-usage":
                '{"123":[{"type":"ads_management","estimated_time_to_regain_access":7}]}',
            },
          },
        );
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await client.listAdAccounts();

    expect(sleepImpl).toHaveBeenCalledWith(7 * 60_000);
  });

  it("falls back to the documented block when Meta advertises nothing", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { message: "blocked", code: 80004, error_subcode: 2446079 } },
          { status: 400 },
        );
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await client.listAdAccounts();

    expect(sleepImpl).toHaveBeenCalledWith(300_000);
  });
});

describe("createMetaClient — creative assets come from catalogs, not renders", () => {
  it("asks /ads for hashes and ids only — never a rendered thumbnail", async () => {
    // thumbnail_width/height are documented as "Rendered": a cold image resize
    // per row. That is what collapsed page size to 25 on a 2,540-ad account
    // and turned one walk into ~102 calls. Hashes are plain stored JSON.
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await client.listAds("act_123");

    const fields = new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("fields") ?? "";
    expect(fields).not.toContain("thumbnail_width");
    expect(fields).not.toContain("thumbnail_height");
    expect(fields).toContain("image_hash");
    expect(fields).toContain("video_id");
    // Hashes are scattered across creative types — checking one place loses
    // whole categories of ad.
    expect(fields).toContain("object_story_spec");
    expect(fields).toContain("asset_feed_spec");
  });

  it("reads the image library as one edge call, not one call per hash", async () => {
    // Meta counts ?ids= as one call PER ID, so the batch form would cost 50
    // points for 50 hashes. `hashes` is an edge filter — a single read.
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ data: [{ hash: "h1", permalink_url: "https://fb/permanent" }] }),
    );
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    const images = await client.listAdImages("act_123", ["h1", "h2"]);

    expect(fetchImpl.mock.calls.length).toBe(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toContain("/act_123/adimages");
    expect(url.searchParams.get("ids")).toBeNull();
    expect(url.searchParams.get("fields")).toContain("permalink_url");
    expect(images[0].permalink_url).toBe("https://fb/permanent");
  });

  it("reads the video library as one edge call, filtered by id", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await client.listAdVideos("act_123", ["v1", "v2"]);

    expect(fetchImpl.mock.calls.length).toBe(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toContain("/act_123/advideos");
    expect(url.searchParams.get("ids")).toBeNull();
    // format{} is a size ladder we pick a card-sized rung from — no render.
    expect(url.searchParams.get("fields")).toContain("format");
  });
});

describe("createMetaClient — honours Meta's own recovery estimate", () => {
  it("waits estimated_time_to_regain_access rather than a guessed duration", async () => {
    // The business-use-case buckets (code 80004) DO advertise a recovery time,
    // in minutes. Guessing shorter earns a longer block; guessing longer
    // wastes a backfill window.
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { message: "too many calls to this ad-account", code: 80004, error_subcode: 2446079 } },
          {
            status: 400,
            headers: {
              "x-business-use-case-usage":
                '{"123":[{"type":"ads_management","estimated_time_to_regain_access":7}]}',
            },
          },
        );
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await client.listAdAccounts();

    expect(sleepImpl).toHaveBeenCalledWith(7 * 60_000);
  });

  it("falls back to the documented block when Meta advertises nothing", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { message: "blocked", code: 80004, error_subcode: 2446079 } },
          { status: 400 },
        );
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await client.listAdAccounts();

    expect(sleepImpl).toHaveBeenCalledWith(300_000);
  });
});


describe("createMetaClient — deadline awareness", () => {
  /**
   * A rate-limit block is 300s; Vercel's kill is absolute. A client that goes
   * to sleep past its invocation budget dies mid-sleep and the sync's catch
   * never closes the run row — the exact wedge that froze Occultyogis. So
   * every sleep first proves it can finish inside deadlineAt, and throws
   * DeadlineError instead of starting one that cannot.
   */
  it("refuses a rate-limit block sleep that cannot finish inside the budget", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(
        { error: { message: "blocked", code: 17, error_subcode: 2446079 } },
        { status: 400 },
      ),
    );
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const client = createMetaClient({
      token: "t",
      apiVersion: API_VERSION,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
      // 10s of budget left — a 300s block sleep can never fit.
      deadlineAt: Date.now() + 10_000,
    });

    await expect(client.listAdAccounts()).rejects.toMatchObject({ name: "DeadlineError" });
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("refuses a score-governor pacing sleep past the deadline", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const client = createMetaClient({
      token: "t",
      apiVersion: API_VERSION,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
      maxScore: 2,
      deadlineAt: Date.now() + 1_000,
    });

    // Two calls exhaust the tiny budget; the third needs a pacing sleep that
    // cannot fit one second of budget.
    await client.listAdAccounts();
    await client.listAdAccounts();
    await expect(client.listAdAccounts()).rejects.toMatchObject({ name: "DeadlineError" });
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("stops a page walk once the budget is exhausted", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
    const client = createMetaClient({
      token: "t",
      apiVersion: API_VERSION,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: vi.fn(async (_ms: number) => {}),
      deadlineAt: Date.now() - 1,
    });

    await expect(client.listAdAccounts()).rejects.toMatchObject({ name: "DeadlineError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("behaves exactly as before when no deadline is configured", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: { message: "slow down", code: 613 } }, { status: 400 });
      }
      return jsonResponse({ data: [] });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const { client } = makeClient(fetchImpl as unknown as typeof fetch, sleepImpl);

    await expect(client.listAdAccounts()).resolves.toEqual([]);
    expect(sleepImpl).toHaveBeenCalledWith(500);
  });
});

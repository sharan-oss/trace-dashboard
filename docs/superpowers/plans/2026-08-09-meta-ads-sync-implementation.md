# Meta Ads Sync (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Meta ad spend into the database — three new tables, a dedicated machine identity, a hand-written Meta Graph API client, admin account-mapping endpoints, and a first sync of one ad account for one day.

**Architecture:** Three dashboard-owned tables join the existing `ads` dimension, all with RLS read policies plus deliberate `WITH CHECK` write policies gated on `is_admin`. A thin typed `fetch` wrapper under `src/lib/meta/` talks to a pinned Graph API version, handling pagination, rate-limit headers and backoff. Route handlers under `src/app/api/ads/` write through a dedicated Supabase Auth service identity, so every write goes through RLS rather than around it.

**Tech Stack:** Next.js 16 App Router route handlers (the project's first), TypeScript strict, `@supabase/supabase-js` ^2.108.2, Vitest. Postgres 17.6 on Supabase project `ggfkbcdegkpqrjmqjfyw`.

Design decisions, the App Review finding, and the connection-model discussion: `~/.claude-work/plans/goofy-foraging-stream.md` (approved 2026-08-09). Source spec: `docs/superpowers/specs/2026-08-09-meta-ads-attribution/02-meta-ads-sync.md`.

## 2026-08-10 refresh — deltas applied at execution time

The plan below is executed as written EXCEPT for these corrections, all evidenced by the live access probe (`scripts/meta-access-probe.ts`, 5/5 green on 2026-08-10) and the collisions recorded in `docs/STATUS.md`:

1. **`sync_runs` is renamed `ad_sync_runs` everywhere** — the literal name `sync_runs` was taken by the Razorpay L2 sync log on 2026-08-10; the two logs have different shapes and must not merge.
2. **Migration file is `20260810130000_ads_sync_tables.sql`** — the plan's `20260810100000` timestamp was taken by the shipped overview RPCs.
3. **API version pin is `v26.0`** (released 2026-07-29), not `v25.0`.
4. **Account discovery is `GET /me/assigned_ad_accounts`** (with `business{id,name}` per account), not `/{business_id}/owned_ad_accounts` + `/client_ad_accounts` — proven live: system-user tokens get "(#100) nonexisting field" on business edges. `META_BUSINESS_ID` is therefore optional and `listAdAccounts()` takes no argument.
5. **The client sends `appsecret_proof`** (HMAC-SHA256 of the token keyed by `META_APP_SECRET`) on every call, matching the probe — a leaked token is useless without the app secret.
6. **Task 5 is UNBLOCKED** — no App Review, no Business Verification. The working System User token (`tracesync` under BM "Alttred Miinds", app "Trace Dashboard" 1882760986033502, `ads_read` Standard Access, `development_access` tier) reads Love School's two client-owned accounts (`act_1052790390047154`, `act_1312705356631852`). Task 2's auth user is created via the Supabase management connection at execution time rather than as a manual Sharan step.

## Global Constraints

Every task's requirements implicitly include this section.

- **Publishable key + RLS only.** Never the secret/service-role key, anywhere, and never inside a request handler.
- **Never write to Trace's five core tables** (`clients`, `products`, `sessions`, `events`, `payments`). This slice writes only to dashboard-owned tables.
- Never query, log or display any `*_secret_enc` column.
- **New tables need `WITH CHECK` write policies.** A `USING`-only policy denies writes outright in Postgres. Copy the three-policy shape from `supabase/migrations/20260809130000_ads_dimension_table.sql`.
- **Money is an integer in minor units (paise).** Meta returns a decimal string; convert via string manipulation, never `parseFloat`. No floating-point currency anywhere.
- **A day is an Asia/Kolkata calendar day**, everywhere, so spend buckets identically to `day_ist` in `v_payments_attributed`.
- The Meta token and the service identity password live in **server-only environment variables** — never `NEXT_PUBLIC_*`, never in a table reachable through PostgREST, never sent to the browser.
- **Target `process.env.META_API_VERSION`, never `latest`.**
- **This is not the Next.js you know.** Before writing any route handler, read the relevant guide under `node_modules/next/dist/docs/` — App Router APIs differ from training-data memory. Heed deprecation notices.
- No live Meta API call in any test. Tests stub `fetch` against recorded fixtures.
- Migration files are `supabase/migrations/YYYYMMDDHHMMSS_<snake_case>.sql`, applied with the Supabase MCP `apply_migration` tool using the same snake_case name. Check the directory for the next free timestamp — several files were renumbered during Slice A and a collision is a real bug.
- Run `npm run typecheck` before every commit. The suite currently has 109 passing tests; none may regress.

---

### Task 1: Migration — the three missing tables

**Files:**
- Create: `supabase/migrations/20260810100000_ads_sync_tables.sql`
- Create: `tests/ads-sync-tables.test.ts`

**Interfaces:**
- Consumes: `public.clients`, `public.ads` (both exist).
- Produces: tables `public.ad_accounts`, `public.ad_insights_daily`, `public.sync_runs`, and the `ads.ad_account_id` foreign key. Tasks 4 and 5 write to all three.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260810100000_ads_sync_tables.sql`:

```sql
-- The three remaining Slice B tables. `ads` already exists (created early so
-- Slice A's attribution could resolve against it); this adds the account,
-- insights and run-log tables around it and finally wires up ads.ad_account_id.
--
-- All three are dashboard-owned, unlike Trace's five core read-only tables, so
-- each carries deliberate WITH CHECK write policies gated on the is_admin
-- claim. In Postgres a USING-only policy denies writes outright, and the
-- service-role key is forbidden inside a request handler, so this is the only
-- way the sync can write at all.
--
-- Every table carries client_id so RLS is a direct column check with no join.

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  meta_ad_account_id text not null unique,
  name text not null,
  currency text not null,
  timezone_name text not null,
  status text not null default 'active',
  -- Nullable, unused in this slice. Reserved so a future per-client OAuth
  -- connect flow can store its own token reference without restructuring;
  -- the System User path leaves this null.
  token_ref text,
  connected_at timestamptz not null default now()
);

create index ad_accounts_client_idx on public.ad_accounts (client_id);

create table public.ad_insights_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  ad_id uuid not null references public.ads(id),
  date_start date not null,
  -- Integer minor units (paise). Never numeric, never float.
  spend_minor bigint not null default 0,
  currency text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  raw jsonb,
  synced_at timestamptz not null default now(),
  -- This constraint is what makes the entire sync idempotent: every write is
  -- an upsert on it, so re-running any window is always safe.
  unique (ad_id, date_start)
);

create index ad_insights_daily_client_date_idx
  on public.ad_insights_daily (client_id, date_start);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  ad_account_id uuid references public.ad_accounts(id),
  kind text not null check (kind in ('backfill', 'nightly', 'manual')),
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  date_from date,
  date_to date,
  meta_report_id text,
  ads_synced integer not null default 0,
  rows_upserted integer not null default 0,
  api_calls integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index sync_runs_account_started_idx
  on public.sync_runs (ad_account_id, started_at desc);

-- ads.ad_account_id was left a bare uuid because ad_accounts did not exist yet.
alter table public.ads
  add constraint ads_ad_account_id_fkey
  foreign key (ad_account_id) references public.ad_accounts(id);

alter table public.ad_accounts enable row level security;
alter table public.ad_insights_daily enable row level security;
alter table public.sync_runs enable row level security;

create policy "dashboard_read_ad_accounts"
  on public.ad_accounts for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_ad_accounts"
  on public.ad_accounts for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_ad_accounts"
  on public.ad_accounts for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_read_ad_insights_daily"
  on public.ad_insights_daily for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_ad_insights_daily"
  on public.ad_insights_daily for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_ad_insights_daily"
  on public.ad_insights_daily for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_read_sync_runs"
  on public.sync_runs for select
  using (
    (auth.jwt() ->> 'is_admin')::boolean is true
    or client_id::text = auth.jwt() ->> 'client_id'
  );

create policy "dashboard_insert_sync_runs"
  on public.sync_runs for insert
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

create policy "dashboard_update_sync_runs"
  on public.sync_runs for update
  using ((auth.jwt() ->> 'is_admin')::boolean is true)
  with check ((auth.jwt() ->> 'is_admin')::boolean is true);

grant select on public.ad_accounts to anon, authenticated;
grant select on public.ad_insights_daily to anon, authenticated;
grant select on public.sync_runs to anon, authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/ads-sync-tables.test.ts`. The write assertions are the point — a client identity must be refused. Every test cleans up after itself.

```ts
import { afterAll, describe, expect, it } from "vitest";
import { adminClient, clientClient } from "./helpers/supabase";

const TABLES = ["ad_accounts", "ad_insights_daily", "sync_runs"] as const;
const createdRunIds: string[] = [];

afterAll(async () => {
  if (createdRunIds.length === 0) return;
  const admin = await adminClient();
  await admin.from("sync_runs").delete().in("id", createdRunIds);
});

describe("ads sync tables — existence and read RLS", () => {
  it.each(TABLES)("%s is readable by admin", async (table) => {
    const admin = await adminClient();
    const { error } = await admin.from(table).select("*", { head: true, count: "exact" });
    expect(error).toBeNull();
  });

  it.each(TABLES)("%s is readable by a client identity without error", async (table) => {
    const client = await clientClient();
    const { error } = await client.from(table).select("*", { head: true, count: "exact" });
    expect(error).toBeNull();
  });
});

describe("ads sync tables — write RLS (the WITH CHECK policies)", () => {
  it("lets the admin identity insert a sync_runs row", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from("sync_runs")
      .insert({ kind: "manual", status: "running" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    createdRunIds.push(data!.id);
  });

  it("refuses a client identity insert into sync_runs", async () => {
    const client = await clientClient();
    const { data, error } = await client
      .from("sync_runs")
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
  it("rejects a sync_runs row with an unknown kind", async () => {
    const admin = await adminClient();
    const { error } = await admin
      .from("sync_runs")
      .insert({ kind: "not_a_real_kind", status: "running" });
    expect(error).not.toBeNull();
  });

  it("rejects a sync_runs row with an unknown status", async () => {
    const admin = await adminClient();
    const { error } = await admin
      .from("sync_runs")
      .insert({ kind: "manual", status: "not_a_real_status" });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/ads-sync-tables.test.ts`
Expected: FAIL — the relations do not exist.

- [ ] **Step 4: Apply the migration**

Supabase MCP `apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `ads_sync_tables`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/ads-sync-tables.test.ts`
Expected: PASS.

If a client-identity insert *succeeds*, the `WITH CHECK` policy is wrong — stop and report. That assertion must never be relaxed.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add supabase/migrations/20260810100000_ads_sync_tables.sql tests/ads-sync-tables.test.ts
git commit -m "feat(db): add ad_accounts, ad_insights_daily and sync_runs with write policies"
```

---

### Task 2: Dedicated sync service identity

A Supabase Auth user used only by the sync, so a production job never depends on the Phase 0 dev-identity stub (which signs in with a password committed to this repo and is slated for deletion in Phase 2).

**Files:**
- Create: `src/lib/auth/service-identity.ts`
- Modify: `.env.example`
- Create: `tests/service-identity.test.ts`

**Interfaces:**
- Consumes: `createClientWithJwt(jwt?)` from `src/lib/supabase/server.ts`.
- Produces: `getSyncJwt(): Promise<string>` and `createSyncClient(): Promise<SupabaseClient>`. Tasks 4 and 5 use `createSyncClient()` for every write.

**Manual prerequisite (Sharan, once):** create a Supabase Auth user `ads-sync@trace.local` with a strong generated password, and set its `raw_app_meta_data` to `{"is_admin": true}` so the existing Custom Access Token Hook injects the claim. Put the credentials in `.env.local` and in Vercel as server-only vars. Do not build a second claims path — `.claude/rules/auth-security.md` forbids it.

- [ ] **Step 1: Add the variable names to `.env.example`**

Names only, no values:

```
# Machine identity for the Meta ads sync (server-only, never NEXT_PUBLIC_*).
# A Supabase Auth user whose raw_app_meta_data carries {"is_admin": true}.
SYNC_IDENTITY_EMAIL=
SYNC_IDENTITY_PASSWORD=
```

- [ ] **Step 2: Write the failing test**

`tests/service-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSyncClient, getSyncJwt } from "@/lib/auth/service-identity";

function decodeClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("sync service identity", () => {
  it("returns a JWT carrying the is_admin claim", async () => {
    const claims = decodeClaims(await getSyncJwt());
    expect(claims.is_admin).toBe(true);
  });

  it("caches the token across calls rather than signing in every time", async () => {
    const [first, second] = [await getSyncJwt(), await getSyncJwt()];
    expect(first).toBe(second);
  });

  it("can write where a client identity cannot", async () => {
    const supabase = await createSyncClient();
    const { data, error } = await supabase
      .from("sync_runs")
      .insert({ kind: "manual", status: "running" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    await supabase.from("sync_runs").delete().eq("id", data!.id);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/service-identity.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write `src/lib/auth/service-identity.ts`**

```ts
/**
 * Machine identity for the Meta ads sync.
 *
 * Deliberately separate from the Phase 0 dev-identity stub: that stub signs in
 * with a password committed to this repository and is slated for deletion once
 * Phase 2 ships real login, so a scheduled production job must not depend on
 * it. This user exists only to run the sync.
 *
 * It authenticates with the publishable key like everything else — the
 * service-role key is forbidden inside a request handler — and relies on the
 * Custom Access Token Hook to inject its is_admin claim from
 * raw_app_meta_data. Writes then pass the new tables' WITH CHECK policies.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClientWithJwt } from "@/lib/supabase/server";

const EXPIRY_BUFFER_MS = 60_000;

let cached: { token: string; expiresAt: number } | undefined;

async function signIn(): Promise<{ token: string; expiresAt: number }> {
  const email = process.env.SYNC_IDENTITY_EMAIL;
  const password = process.env.SYNC_IDENTITY_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SYNC_IDENTITY_EMAIL and SYNC_IDENTITY_PASSWORD must be set for the ads sync"
    );
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return {
    token: data.session!.access_token,
    expiresAt: data.session!.expires_at! * 1000,
  };
}

/** A valid JWT for the sync identity, signing in fresh when missing or near expiry. */
export async function getSyncJwt(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
    return cached.token;
  }
  cached = await signIn();
  return cached.token;
}

/** Supabase client authenticated as the sync identity, writing under RLS. */
export async function createSyncClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getSyncJwt());
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/service-identity.test.ts`
Expected: PASS.

If sign-in fails, the auth user or its `raw_app_meta_data` is not set up — that is the manual prerequisite above. Stop and report rather than falling back to the dev-identity stub.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/auth/service-identity.ts .env.example tests/service-identity.test.ts
git commit -m "feat: add dedicated service identity for the ads sync"
```

---

### Task 3: Meta Graph API client

The project's first outbound HTTP and first typed API client — this sets the pattern. Also the first test in the repo that mocks `fetch`.

**Files:**
- Create: `src/lib/meta/types.ts`
- Create: `src/lib/meta/money.ts`
- Create: `src/lib/meta/client.ts`
- Create: `tests/meta-money.test.ts`
- Create: `tests/meta-client.test.ts`

**Interfaces:**
- Produces:
  - `toMinorUnits(decimal: string, currency: string): number`
  - `createMetaClient(options: MetaClientOptions): MetaClient` with `listAdAccounts(businessId)`, `listAds(adAccountId)`, `getAdInsights(adAccountId, dateStart)`
  - `MetaClientOptions = { token: string; apiVersion: string; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> }`
  - `class MetaApiError extends Error` with `code`, `subcode`, `status`
- Task 5 consumes all of these.

- [ ] **Step 1: Write the failing money test**

`tests/meta-money.test.ts`. Money conversion gets its own file because a float bug here silently corrupts every revenue comparison.

```ts
import { describe, expect, it } from "vitest";
import { toMinorUnits } from "@/lib/meta/money";

describe("toMinorUnits", () => {
  it("converts a two-decimal string to paise", () => {
    expect(toMinorUnits("123.45", "INR")).toBe(12345);
  });

  it("converts a whole number with no decimal point", () => {
    expect(toMinorUnits("500", "INR")).toBe(50000);
  });

  it("pads a single decimal place", () => {
    expect(toMinorUnits("12.5", "INR")).toBe(1250);
  });

  it("handles zero", () => {
    expect(toMinorUnits("0", "INR")).toBe(0);
    expect(toMinorUnits("0.00", "INR")).toBe(0);
  });

  it("does not lose precision on a value floats get wrong", () => {
    // 8.29 * 100 is 828.9999... in IEEE 754; a parseFloat implementation
    // rounds to 829 by luck here but fails on other values, so assert the
    // exact expected integer for several known-awkward inputs.
    expect(toMinorUnits("8.29", "INR")).toBe(829);
    expect(toMinorUnits("1.005", "INR")).toBe(100); // truncates beyond 2dp, never rounds up
    expect(toMinorUnits("19.99", "INR")).toBe(1999);
    expect(toMinorUnits("1234567.89", "INR")).toBe(123456789);
  });

  it("throws on a non-numeric value rather than silently returning 0", () => {
    expect(() => toMinorUnits("not a number", "INR")).toThrow();
    expect(() => toMinorUnits("", "INR")).toThrow();
  });
});
```

- [ ] **Step 2: Write `src/lib/meta/money.ts`**

```ts
/**
 * Currency conversion for Meta's spend values.
 *
 * Meta returns spend as a decimal STRING in the ad account's currency. It is
 * converted by string manipulation, never parseFloat: binary floating point
 * cannot represent most decimal fractions exactly, and a cent lost per row
 * compounds across every ROAS figure in the product.
 *
 * Everything downstream stores integer minor units, matching payments.amount.
 */
const MINOR_UNIT_DIGITS: Record<string, number> = { INR: 2 };
const DEFAULT_MINOR_UNIT_DIGITS = 2;

export function toMinorUnits(decimal: string, currency: string): number {
  const trimmed = decimal?.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`toMinorUnits: not a decimal number: ${JSON.stringify(decimal)}`);
  }

  const digits = MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? DEFAULT_MINOR_UNIT_DIGITS;
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");

  // Truncate rather than round: Meta's own totals truncate, and rounding up
  // would let reported spend exceed what was actually charged.
  const scaled = `${whole}${fraction.padEnd(digits, "0").slice(0, digits)}`;
  const value = Number.parseInt(scaled, 10);
  return negative ? -value : value;
}
```

- [ ] **Step 3: Run the money test**

Run: `npm test -- tests/meta-money.test.ts`
Expected: PASS.

- [ ] **Step 4: Write `src/lib/meta/types.ts`**

```ts
/** Response shapes for the four Graph API endpoints this project reads. */

export type MetaPaging = {
  cursors?: { before?: string; after?: string };
  next?: string;
};

export type MetaListResponse<T> = {
  data: T[];
  paging?: MetaPaging;
};

export type MetaAdAccount = {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status?: number;
};

export type MetaAdRef = { id: string; name: string };

export type MetaAdCreative = {
  id: string;
  thumbnail_url?: string;
  image_url?: string;
};

export type MetaAd = {
  id: string;
  name: string;
  status: string;
  adset?: MetaAdRef;
  campaign?: MetaAdRef;
  creative?: MetaAdCreative;
};

export type MetaInsightRow = {
  ad_id: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
};
```

- [ ] **Step 5: Write the failing client test**

`tests/meta-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MetaApiError, createMetaClient } from "@/lib/meta/client";

const API_VERSION = "v25.0";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function makeClient(fetchImpl: typeof fetch, sleepImpl = vi.fn(async () => {})) {
  return {
    client: createMetaClient({ token: "test-token", apiVersion: API_VERSION, fetchImpl, sleepImpl }),
    sleepImpl,
  };
}

describe("createMetaClient — request shape", () => {
  it("targets the pinned API version and never 'latest'", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain(`/${API_VERSION}/`);
    expect(url).not.toContain("latest");
  });

  it("sends the token as a bearer header, never in the query string", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain("test-token");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
  });

  it("requests paused and archived ads so retired ads still resolve", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.listAds("act_123");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("effective_status");
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
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "1", name: "one", status: "ACTIVE" }] }));
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
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 17 } }, { status: 400 }));
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
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);
    await client.getAdInsights("act_123", "2026-08-01");

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("level=ad");
    expect(url).toContain("time_increment=1");
    expect(url).toContain("2026-08-01");
  });
});
```

- [ ] **Step 6: Write `src/lib/meta/client.ts`**

```ts
/**
 * Thin typed client for the four Graph API endpoints this project reads.
 *
 * Hand-written rather than the official SDK, deliberately: this needs four
 * read-only endpoints and absolute control over which API version is called.
 * Meta sunsets versions on a schedule, so moving is an explicit act — which is
 * what Airbyte and Fivetran do for the same job.
 *
 * fetch and sleep are injectable so the whole retry and rate-limit path is
 * testable without a live call or a real delay.
 */
import type {
  MetaAd,
  MetaAdAccount,
  MetaInsightRow,
  MetaListResponse,
} from "@/lib/meta/types";

const GRAPH_HOST = "https://graph.facebook.com";
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const USAGE_THROTTLE_PERCENT = 80;
const USAGE_THROTTLE_MS = 2_000;
/** Meta's rate-limit error codes: 17 user request limit, 613 calls-per-hour. */
const RATE_LIMIT_CODES = new Set([17, 613]);

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly status: number;

  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

export type MetaClientOptions = {
  token: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
};

export type MetaClient = {
  listAdAccounts(businessId: string): Promise<MetaAdAccount[]>;
  listAds(adAccountId: string): Promise<MetaAd[]>;
  getAdInsights(adAccountId: string, dateStart: string): Promise<MetaInsightRow[]>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Highest call_count percentage across every bucket in the usage header. */
function peakUsagePercent(header: string | null): number {
  if (!header) return 0;
  try {
    const parsed = JSON.parse(header) as Record<
      string,
      Array<{ call_count?: number; total_cputime?: number; total_time?: number }>
    >;
    let peak = 0;
    for (const entries of Object.values(parsed)) {
      for (const entry of entries) {
        peak = Math.max(
          peak,
          entry.call_count ?? 0,
          entry.total_cputime ?? 0,
          entry.total_time ?? 0
        );
      }
    }
    return peak;
  } catch {
    return 0;
  }
}

export function createMetaClient(options: MetaClientOptions): MetaClient {
  const { token, apiVersion } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleepImpl ?? defaultSleep;

  async function requestOnce(url: string): Promise<{ body: unknown; response: Response }> {
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    return { body, response };
  }

  /** One request with retry on rate-limit errors, and throttling on high usage. */
  async function request<T>(url: string): Promise<T> {
    let attempt = 0;

    for (;;) {
      const { body, response } = await requestOnce(url);
      const error = (body as { error?: { message?: string; code?: number; error_subcode?: number } })
        .error;

      if (error) {
        const retryable = RATE_LIMIT_CODES.has(error.code ?? -1);
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * 2 ** attempt);
          attempt += 1;
          continue;
        }
        throw new MetaApiError(
          error.message ?? "Meta API request failed",
          response.status,
          error.code,
          error.error_subcode
        );
      }

      if (peakUsagePercent(response.headers.get("x-business-use-case-usage")) >= USAGE_THROTTLE_PERCENT) {
        await sleep(USAGE_THROTTLE_MS);
      }

      return body as T;
    }
  }

  /** Follows paging.next until exhausted. Never assume one page. */
  async function requestAll<T>(firstUrl: string): Promise<T[]> {
    const results: T[] = [];
    let url: string | undefined = firstUrl;

    while (url) {
      const page = await request<MetaListResponse<T>>(url);
      results.push(...(page.data ?? []));
      url = page.paging?.next;
    }

    return results;
  }

  function endpoint(path: string, params: Record<string, string>): string {
    const url = new URL(`${GRAPH_HOST}/${apiVersion}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  return {
    async listAdAccounts(businessId) {
      const fields = "id,account_id,name,currency,timezone_name,account_status";
      const owned = await requestAll<MetaAdAccount>(
        endpoint(`${businessId}/owned_ad_accounts`, { fields, limit: "100" })
      );
      const client = await requestAll<MetaAdAccount>(
        endpoint(`${businessId}/client_ad_accounts`, { fields, limit: "100" })
      );
      const byId = new Map<string, MetaAdAccount>();
      for (const account of [...owned, ...client]) byId.set(account.id, account);
      return [...byId.values()];
    },

    async listAds(adAccountId) {
      return requestAll<MetaAd>(
        endpoint(`${adAccountId}/ads`, {
          fields:
            "id,name,adset{id,name},campaign{id,name},status,creative{id,thumbnail_url,image_url}",
          // Include paused and archived ads, so a historical name match still
          // resolves after an ad is retired.
          effective_status: JSON.stringify([
            "ACTIVE",
            "PAUSED",
            "DELETED",
            "ARCHIVED",
            "CAMPAIGN_PAUSED",
            "ADSET_PAUSED",
          ]),
          limit: "100",
        })
      );
    },

    async getAdInsights(adAccountId, dateStart) {
      return requestAll<MetaInsightRow>(
        endpoint(`${adAccountId}/insights`, {
          level: "ad",
          time_increment: "1",
          fields: "ad_id,spend,impressions,clicks,reach",
          time_range: JSON.stringify({ since: dateStart, until: dateStart }),
          limit: "500",
        })
      );
    },
  };
}
```

- [ ] **Step 7: Run the client test**

Run: `npm test -- tests/meta-client.test.ts tests/meta-money.test.ts`
Expected: PASS. No network access occurs — if a test hangs, a real `fetch` is leaking through; fix the injection rather than adding a timeout.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/meta tests/meta-client.test.ts tests/meta-money.test.ts
git commit -m "feat: add typed Meta Graph API client with pagination and backoff"
```

---

### Task 4: Admin account-mapping endpoints

The project's first route handlers. **Read the App Router route-handler guide under `node_modules/next/dist/docs/` before writing these** — this Next.js version's APIs differ from training-data memory.

**Files:**
- Create: `src/app/api/ads/accounts/route.ts`
- Create: `src/app/api/ads/accounts/[id]/route.ts`
- Create: `src/lib/meta/env.ts`
- Create: `tests/api-ads-accounts.test.ts`

**Interfaces:**
- Consumes: `createSyncClient()` (Task 2), `createMetaClient()` (Task 3).
- Produces: `getMetaConfig()` from `src/lib/meta/env.ts`, returning `{ token, apiVersion, businessId }` from server-only env and throwing a clear error when unset.

- [ ] **Step 1: Add the Meta variables to `.env.example`**

```
# Meta Marketing API (server-only — never NEXT_PUBLIC_*).
META_SYSTEM_USER_TOKEN=
META_API_VERSION=v25.0
META_BUSINESS_ID=
# Shared secret proving a sync request came from Vercel Cron.
CRON_SECRET=
```

- [ ] **Step 2: Write `src/lib/meta/env.ts`**

```ts
/**
 * Server-only Meta configuration.
 *
 * The token is deliberately an environment variable rather than Supabase
 * Vault: reading Vault needs privileges forbidden inside a request handler,
 * and the only way to reach it under publishable-key + RLS would be a
 * SECURITY DEFINER function, which would make the token readable over
 * PostgREST by any admin browser session. An env var is never reachable by the
 * client SDK at all.
 */
export type MetaConfig = {
  token: string;
  apiVersion: string;
  businessId: string;
};

export function getMetaConfig(): MetaConfig {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const apiVersion = process.env.META_API_VERSION;
  const businessId = process.env.META_BUSINESS_ID;

  const missing = [
    !token && "META_SYSTEM_USER_TOKEN",
    !apiVersion && "META_API_VERSION",
    !businessId && "META_BUSINESS_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Meta configuration missing: ${missing.join(", ")}`);
  }

  return { token: token!, apiVersion: apiVersion!, businessId: businessId! };
}
```

- [ ] **Step 3: Write the failing test**

`tests/api-ads-accounts.test.ts`. The handlers are imported and invoked directly with a `Request` — no server is started.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const listAdAccounts = vi.fn();

vi.mock("@/lib/meta/client", () => ({
  createMetaClient: () => ({ listAdAccounts, listAds: vi.fn(), getAdInsights: vi.fn() }),
  MetaApiError: class extends Error {},
}));

vi.mock("@/lib/meta/env", () => ({
  getMetaConfig: () => ({ token: "t", apiVersion: "v25.0", businessId: "123" }),
}));

const CLIENT_ID = "cb7daf9d-28f1-4699-a587-afb6e2ec44da"; // Love School

async function importRoute() {
  return import("@/app/api/ads/accounts/route");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ads/accounts", () => {
  it("returns the accounts the System User can see", async () => {
    listAdAccounts.mockResolvedValue([
      { id: "act_1", account_id: "1", name: "Love School Ads", currency: "INR", timezone_name: "Asia/Kolkata" },
    ]);
    const { GET } = await importRoute();
    const response = await GET(new Request("http://localhost/api/ads/accounts"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toHaveLength(1);
  });

  it("returns 502 when Meta is unreachable", async () => {
    listAdAccounts.mockRejectedValue(new Error("network down"));
    const { GET } = await importRoute();
    const response = await GET(new Request("http://localhost/api/ads/accounts"));
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tests/api-ads-accounts.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 5: Write the route handlers**

`src/app/api/ads/accounts/route.ts` — GET lists Meta accounts plus current mappings; POST maps one to a client, rejecting a non-INR currency with 422 so ROAS can never divide mismatched units. Both use `createSyncClient()` for database access and `getMetaConfig()` + `createMetaClient()` for Meta. Return `Response.json(...)` with explicit status codes: 400 missing fields, 409 already mapped, 422 unknown account or wrong currency, 502 Meta unreachable.

`src/app/api/ads/accounts/[id]/route.ts` — DELETE sets `status = 'disconnected'` and returns 404 for an unknown mapping. **It must never delete the row**: history is retained so past ROAS never changes. Note that this Next.js version's dynamic route params may be async — confirm against the local docs rather than assuming.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tests/api-ads-accounts.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite, typecheck and commit**

```bash
npm test && npm run typecheck
git add src/app/api src/lib/meta/env.ts .env.example tests/api-ads-accounts.test.ts
git commit -m "feat: add admin account-mapping endpoints"
```

---

### Task 5: Sync one account for one day — BLOCKED

**Do not start this task until the prerequisites below are confirmed done.** It is the only task requiring a live Meta call.

Blocked on, all Sharan's, none started as of 2026-08-09:

1. Business Verification for the Meta app.
2. **App Review approval for `ads_read` Advanced access.** Partner-shared accounts are "other people's ad accounts" in Meta's terms, so Standard access is not sufficient. Multi-week lead time.
3. The agency System User created in Business Settings, with its token in `META_SYSTEM_USER_TOKEN`.
4. At least one client granting the System User the view-performance task — Occultyogis first, since it unlocks names for 2,342 sessions and makes Slice A's cross-tenant guard testable.

When unblocked, the task is: POST `/api/ads/sync` authenticated by `CRON_SECRET` or an admin session, returning 409 if a run is already in progress for that account. For one account and one day, upsert ad metadata into `ads` on `meta_ad_id` (adopting the 67 hand-seeded Love School rows — refresh names and status, fill `ad_account_id`, set `last_synced_at`), upsert insights into `ad_insights_daily` on `(ad_id, date_start)` using `toMinorUnits` for spend, and write one `sync_runs` row transitioning `running → success | partial | failed`. Request insights in the ad account's own timezone but store `date_start` as the Asia/Kolkata date.

Tests: running the same window twice produces no duplicate rows and no changed totals; a mid-run failure leaves `sync_runs` in `failed`; spend is stored as an integer.

---

## Acceptance criteria coverage

| AC | Requirement | Covered by |
|---|---|---|
| AC-7 | Admin maps a client to ad accounts, disconnect retains history | Tasks 1 and 4 |
| AC-8 | One row per ad per day, unique `(ad_id, date_start)`, re-runnable | Task 1 (constraint), Task 5 (upsert) |
| AC-10 | Spend as integer minor units with currency recorded | Task 1 (`spend_minor bigint`), Task 3 (`toMinorUnits`) |
| AC-13 | Every attempt writes a `sync_runs` row | Task 1, Task 5 |
| AC-14 | Credential never in the browser or a client-readable table | Task 4 (`env.ts`, server-only) |
| AC-15 | Rate limits respected, backoff on code 17, pinned version | Task 3 |
| AC-6 | New tables return only the caller's rows unless admin | Task 1 |

AC-9, AC-11 and AC-12 (backfill, creative mirroring, inactive marking) are Slice C.

## Out of scope

Backfill from 2026-06-27, the nightly Vercel Cron and its rolling seven-day window, creative thumbnail mirroring into Supabase Storage, and marking absent ads inactive — all Slice C. The Ads UI is Slice D. Client self-serve OAuth connect is a later slice, after Phase 2 real login.

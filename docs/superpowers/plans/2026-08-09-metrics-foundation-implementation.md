# Metrics Foundation (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Postgres read layer (helper functions + three views) plus a typed query layer that makes Trace's existing session/payment/event data trustworthy — normalized UTM sources, marked test rows, a canonical ad key, two separately named metrics, and an explicit Unattributed bucket.

**Architecture:** All data logic lives in Postgres. Immutable `public.metric_*` SQL functions hold the single definition of every extraction rule; three `security_invoker` views compose them over `sessions`, `payments` and `events`. A thin TypeScript layer under `src/lib/metrics/` holds only pure presentation-side arithmetic (the two named metrics, the Unattributed grouping helper). Nothing writes to Trace's tables.

**Tech Stack:** Postgres 17.6 (Supabase project `ggfkbcdegkpqrjmqjfyw`), `@supabase/supabase-js` ^2.108.2, TypeScript strict, Vitest (added by Task 1) running in a Node environment against the live database under real RLS-scoped JWTs.

Source spec: [`docs/superpowers/specs/2026-08-09-meta-ads-attribution/01-metrics-foundation.md`](../specs/2026-08-09-meta-ads-attribution/01-metrics-foundation.md). Acceptance criteria AC-1 to AC-6 and AC-20 live in the umbrella [`index.md`](../specs/2026-08-09-meta-ads-attribution/index.md).

---

## Spec corrections verified against the live database on 2026-08-09

The spec's `rationale.md` profile contains one significant error and several gaps. These were re-measured directly and **this plan's values supersede the spec's**. Record them; do not "fix" the code back toward the spec text.

1. **Love School DOES carry ad identifiers on sessions.** The spec says "Love School has ZERO ad IDs on sessions" and calls it "the single most consequential number in this profile". It is wrong. 2,827 of 8,199 Love School sessions (34%) carry a real numeric ad ID in `landing_url` under the key `Ad+ID` (a URL-encoded `Ad ID`), spanning 7 distinct ads. The original profile only looked for the `h_ad_id` / `ad_id` spellings. Consequence: Love School gets genuine identifier-based ad attribution on a third of its sessions, not name-matching only.
2. **Unexpanded Meta macros are present and must be rejected.** 16 sessions carry the literal value `%7b%7bad.id%7d%7d` (URL-encoded `{{ad.id}}`) — the dynamic-parameter macro was never expanded. A further 4 rows carry `null` or `_removed_`. Any of these treated as an ad key would create phantom ads.
3. **Ad-ID key variants never disagree.** Of 1,962 sessions carrying both `h_ad_id` and `ad_id`, zero have different values. A single regex matching any variant is therefore safe, and the spec's "first non-null of the variants" priority ordering is moot.
4. **No URL decoding is needed anywhere in this slice.** Every value extracted is either a numeric ID or an already-decoded column. Only *key names* need encoding tolerance (`Ad+ID`, `Ad%20ID`, `Ad ID`, `Ad_id`), which the key regex handles.
5. **`utm_id` is not always numeric.** Both paying clients use numeric campaign IDs, but the test client (The Batra Numerology) uses `june-test-01`. The campaign key therefore gets the generic junk filter, **not** the strict numeric guard used for ad IDs.
6. **Row counts have drifted** (sessions 10,576, payments 969 as of writing) because the database is live. Tests must assert invariants and relationships, never absolute row counts.

## Global Constraints

Every task's requirements implicitly include this section.

- **This dashboard never writes to `clients`, `products`, `sessions`, `events` or `payments`.** This slice creates functions and views only.
- **Never select `c.*` from `clients` into any view.** The `*_secret_enc` columns are AES-256-GCM ciphertext and must never be queried, logged or displayed. Only a derived boolean may cross from `clients` into a view.
- **Never use the secret/service-role key.** Publishable key + RLS only.
- Every view is created `with (security_invoker = true)` so base-table RLS applies to the querying user, not the view owner.
- **RLS is verified through the client SDK with a real test-user JWT, never through the SQL editor**, which bypasses RLS.
- A day is an **Asia/Kolkata** calendar day everywhere: `(<timestamptz> at time zone 'Asia/Kolkata')::date`.
- Money stays an integer in paise. No floating-point currency.
- **Never use `LIKE`/`ILIKE` with `%..._...%` on these column or key names.** In SQL `LIKE`, `_` is a single-character wildcard, so `'%fbc_id%'` matches `fbclid`. Use anchored regular expressions or `starts_with()`.
- The two metrics are named **"Conversion rate"** (paid ÷ sessions) and **"Checkout completion"** (paid ÷ attempts). Neither may ever be labelled simply "conversion".
- Any grouping by `ad_key` or `campaign_key` emits an explicit **Unattributed** row rather than dropping rows. Grouped rows plus Unattributed must equal the ungrouped total.
- Migration files are named `supabase/migrations/YYYYMMDDHHMMSS_<snake_case>.sql` and are applied to the live project with the Supabase MCP `apply_migration` tool using the same snake_case name.
- Commit after each task. Run `npm run typecheck` before every commit.

---

### Task 1: Test harness

Vitest in a Node environment, running against the live database through the two Phase 0 dev identities. Every later task depends on this.

**Files:**
- Modify: `package.json` (devDependencies + `test` script)
- Create: `vitest.config.ts`
- Create: `tests/helpers/supabase.ts`
- Create: `tests/rls-baseline.test.ts`
- Modify: `tsconfig.json` (add `"types": ["vitest/globals"]`)

**Interfaces:**
- Consumes: `src/lib/auth/dev-identity.ts` → `getDevJwt(role: "admin" | "client"): Promise<string>`; `src/lib/supabase/server.ts` → `createClientWithJwt(jwt?: string)`
- Produces, from `tests/helpers/supabase.ts`, used by every later integration test: `adminClient(): Promise<SupabaseClient>`, `clientClient(): Promise<SupabaseClient>`, `countRows(supabase, relation): Promise<number>`, `expectStableEqualCounts(supabase, relationA, relationB, attempts?): Promise<void>`.

- [ ] **Step 1: Install dependencies**

```bash
npm install -D vitest vite-tsconfig-paths dotenv
```

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block, alongside the existing entries:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

Node environment (these are database integration tests, not DOM tests). `.env.local` is loaded explicitly because Vitest does not read Next.js env files. A long timeout accommodates the `signInWithPassword` round-trip on a cold cache.

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Add Vitest globals to `tsconfig.json`**

Add `"types": ["vitest/globals"]` inside `compilerOptions`, and make sure `tests` is covered by `include` (add `"tests/**/*.ts"` if the existing `include` does not already match it).

- [ ] **Step 5: Create `tests/helpers/supabase.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDevJwt } from "@/lib/auth/dev-identity";
import { createClientWithJwt } from "@/lib/supabase/server";

/** Supabase client carrying the admin JWT (is_admin claim) — sees every client's rows. */
export async function adminClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getDevJwt("admin"));
}

/** Supabase client carrying the test-client JWT (client_id claim) — sees one client's rows. */
export async function clientClient(): Promise<SupabaseClient> {
  return createClientWithJwt(await getDevJwt("client"));
}

/** Exact row count for a table or view under the given client, failing loudly on error. */
export async function countRows(
  supabase: SupabaseClient,
  relation: string
): Promise<number> {
  const { count, error } = await supabase
    .from(relation)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${relation}) failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Asserts two relations hold the same number of rows.
 *
 * The database is live and rows arrive during the test run, so two sequential
 * counts can legitimately disagree by a row or two. Retrying preserves an exact
 * equality assertion — a view that genuinely drops rows fails every attempt,
 * while a concurrent insert is shaken off — which a fuzzy tolerance would not.
 */
export async function expectStableEqualCounts(
  supabase: SupabaseClient,
  relationA: string,
  relationB: string,
  attempts = 3
): Promise<void> {
  let last: [number, number] = [0, 0];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const a = await countRows(supabase, relationA);
    const b = await countRows(supabase, relationB);
    if (a === b) return;
    last = [a, b];
  }
  throw new Error(
    `counts still differ after ${attempts} attempts: ${relationA}=${last[0]}, ${relationB}=${last[1]}`
  );
}
```

- [ ] **Step 6: Write the failing baseline test**

`tests/rls-baseline.test.ts`. This pins the harness itself: both identities authenticate, and RLS demonstrably scopes the client identity below the admin. It asserts a *relationship*, never a fixed count, because the database is live.

```ts
import { describe, expect, it } from "vitest";
import { adminClient, clientClient, countRows } from "./helpers/supabase";

describe("RLS baseline", () => {
  it("scopes the client identity strictly below admin on payments", async () => {
    const [admin, client] = await Promise.all([adminClient(), clientClient()]);
    const [adminCount, clientCount] = await Promise.all([
      countRows(admin, "payments"),
      countRows(client, "payments"),
    ]);

    expect(adminCount).toBeGreaterThan(0);
    expect(clientCount).toBeGreaterThan(0);
    expect(clientCount).toBeLessThan(adminCount);
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npm test`
Expected: PASS. If it fails on missing env vars, `.env.local` is not being loaded — fix `vitest.config.ts`, do not hardcode credentials. If it fails on authentication, the two Phase 0 test users or the Custom Access Token Hook need checking (see `.claude/rules/auth-security.md`); stop and report rather than working around it.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add package.json package-lock.json vitest.config.ts tsconfig.json tests/
git commit -m "test: add Vitest harness with RLS-scoped Supabase test clients"
```

---

### Task 2: Metric helper functions migration

The single definition of every extraction rule, as immutable SQL functions in `public` so they are unit-testable over RPC. They are pure text/jsonb transforms — they read no tables and expose no data.

**Files:**
- Create: `supabase/migrations/20260809120000_metric_helper_functions.sql`
- Create: `tests/metric-helpers.test.ts`

**Interfaces:**
- Produces (all `immutable`, `parallel safe`, callable via `supabase.rpc()`):
  - `public.metric_ad_id_key_pattern() -> text`
  - `public.metric_normalize_ad_id(raw text) -> text`
  - `public.metric_normalize_key(raw text) -> text`
  - `public.metric_clean_utm_source(raw text) -> text`
  - `public.metric_ad_id_from_url(url text) -> text`
  - `public.metric_ad_id_from_params(params jsonb) -> text`
  - `public.metric_campaign_id_from_url(url text) -> text`
  - Tasks 3 and 4 compose these; they must not re-derive any rule inline.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809120000_metric_helper_functions.sql`:

```sql
-- Shared extraction rules for the dashboard's metrics read layer.
--
-- These live in `public` (not a private schema) so they are reachable over
-- PostgREST RPC and can be unit-tested directly from the test suite. That is
-- safe: every function here is a pure text/jsonb transform that reads no
-- table and holds no secret. They are the ONE definition of each rule —
-- v_sessions_attributed and v_payments_attributed compose them rather than
-- re-implementing the regexes, so a new key variant is a one-line change here.
--
-- Anchored regexes throughout. Never LIKE '%h_ad_id%': in LIKE, `_` is a
-- single-character wildcard, so '%fbc_id%' matches 'fbclid'.

-- The ad-identifier key variants, as one pattern used by both the URL side
-- (sessions.landing_url, where a space is encoded as `+` or `%20`) and the
-- jsonb side (payments.utm_params, where keys are already decoded).
-- Covers: h_ad_id, ad_id, Ad_id, Ad ID, Ad+ID, Ad%20ID, adid.
create or replace function public.metric_ad_id_key_pattern()
returns text language sql immutable parallel safe as $$
  select '(?:h_ad_id|ad(?:_|\+|%20|\s)?id)'
$$;

-- A Meta ad identifier is always a long integer. Anything else is junk:
-- unexpanded macros ({{ad.id}} / %7b%7bad.id%7d%7d), the literal strings
-- 'null' and '_removed_', or an empty value. Rejecting these stops phantom
-- ads appearing in every breakdown.
create or replace function public.metric_normalize_ad_id(raw text)
returns text language sql immutable parallel safe as $$
  select case when raw ~ '^[0-9]{6,}$' then raw end
$$;

-- Generic junk filter for non-numeric keys (campaign ids, ad names). Campaign
-- ids are numeric for the paying clients but not universally — the test client
-- uses 'june-test-01' — so this must not require digits.
create or replace function public.metric_normalize_key(raw text)
returns text language sql immutable parallel safe as $$
  select case
    when raw is null then null
    when btrim(raw) = '' then null
    when lower(btrim(raw)) in ('null', 'undefined', '_removed_') then null
    when raw ~* '(\{\{|%7b%7b)' then null
    else btrim(raw)
  end
$$;

-- Repairs the capture bug where the parameter key leaked into its own value,
-- splitting one traffic source across two rows ('utm_source=METAxAM' and
-- 'METAxAM'). Read-layer repair only; the capture fix belongs in the Trace repo.
create or replace function public.metric_clean_utm_source(raw text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(
    regexp_replace(raw, '^utm_source=', '', 'i')
  )
$$;

-- First ad identifier in a URL query string, or null.
create or replace function public.metric_ad_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(
    (regexp_match(
      url,
      '[?&]' || public.metric_ad_id_key_pattern() || '=([^&#]*)',
      'i'
    ))[1]
  )
$$;

-- First ad identifier among the jsonb keys, or null. Only keys matching the
-- shared variant pattern are ever read by name: the utm_params key space is
-- unbounded because campaign names leak into it as keys, so nothing may
-- enumerate keys generically. The jsonb_typeof guard keeps a non-object
-- payload from raising.
create or replace function public.metric_ad_id_from_params(params jsonb)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(e.value)
  from jsonb_each_text(
    case when jsonb_typeof(params) = 'object' then params else '{}'::jsonb end
  ) as e
  where e.key ~* ('^' || public.metric_ad_id_key_pattern() || '$')
    and public.metric_normalize_ad_id(e.value) is not null
  limit 1
$$;

-- Campaign identifier from a URL query string. Junk filter only, no numeric
-- guard: campaign ids are numeric for the paying clients but not for all.
create or replace function public.metric_campaign_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(
    (regexp_match(url, '[?&]utm_id=([^&#]*)', 'i'))[1]
  )
$$;

grant execute on function
  public.metric_ad_id_key_pattern(),
  public.metric_normalize_ad_id(text),
  public.metric_normalize_key(text),
  public.metric_clean_utm_source(text),
  public.metric_ad_id_from_url(text),
  public.metric_ad_id_from_params(jsonb),
  public.metric_campaign_id_from_url(text)
to anon, authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/metric-helpers.test.ts`. Each case is drawn from a real shape observed in the live data.

```ts
import { describe, expect, it } from "vitest";
import { adminClient } from "./helpers/supabase";

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await adminClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

const LOVE_SCHOOL_URL =
  "https://workshop.schooloflove.co.in/love-magnet-workshop/?Ad+ID=120242114093820519&Adset+content=LS+01";
const OCCULT_URL =
  "https://vastu.occultyogis.com/devurja-vastu-fb/?utm_source=fb&utm_id=120987654321&Ad_id=120246979966760";

describe("metric_ad_id_from_url", () => {
  it("extracts a plus-encoded 'Ad+ID' key (Love School's shape)", async () => {
    expect(await rpc("metric_ad_id_from_url", { url: LOVE_SCHOOL_URL })).toBe(
      "120242114093820519"
    );
  });

  it("extracts an 'Ad_id' key (Occultyogis' shape)", async () => {
    expect(await rpc("metric_ad_id_from_url", { url: OCCULT_URL })).toBe(
      "120246979966760"
    );
  });

  it("extracts an 'h_ad_id' key", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?h_ad_id=120111222333" })
    ).toBe("120111222333");
  });

  it("rejects an unexpanded {{ad.id}} macro", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad+ID=%7b%7bad.id%7d%7d" })
    ).toBeNull();
  });

  it("rejects literal null and _removed_ values", async () => {
    expect(await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad+ID=null" })).toBeNull();
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?Ad+ID=_removed_" })
    ).toBeNull();
  });

  it("does not match fbclid (the LIKE underscore-wildcard trap)", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?fbclid=120999888777" })
    ).toBeNull();
  });

  it("returns null when no ad key is present", async () => {
    expect(
      await rpc("metric_ad_id_from_url", { url: "https://x.com/?utm_source=fb" })
    ).toBeNull();
  });
});

describe("metric_ad_id_from_params", () => {
  it("reads a decoded 'Ad ID' key", async () => {
    expect(
      await rpc("metric_ad_id_from_params", { params: { "Ad ID": "120242114093820519" } })
    ).toBe("120242114093820519");
  });

  it("reads an 'h_ad_id' key and ignores fbc_id", async () => {
    expect(
      await rpc("metric_ad_id_from_params", {
        params: { fbc_id: "120555", h_ad_id: "120246979966760" },
      })
    ).toBe("120246979966760");
  });

  it("ignores campaign names that leaked in as keys", async () => {
    expect(
      await rpc("metric_ad_id_from_params", {
        params: { "Love +Reality Show - 12/12/2025": "120777666555" },
      })
    ).toBeNull();
  });

  it("returns null for an empty object", async () => {
    expect(await rpc("metric_ad_id_from_params", { params: {} })).toBeNull();
  });
});

describe("metric_campaign_id_from_url", () => {
  it("extracts a numeric utm_id", async () => {
    expect(await rpc("metric_campaign_id_from_url", { url: OCCULT_URL })).toBe(
      "120987654321"
    );
  });

  it("preserves a non-numeric campaign id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=june-test-01" })
    ).toBe("june-test-01");
  });
});

describe("metric_clean_utm_source", () => {
  it("strips a leaked utm_source= prefix", async () => {
    expect(await rpc("metric_clean_utm_source", { raw: "utm_source=METAxAM" })).toBe(
      "METAxAM"
    );
  });

  it("leaves a clean value untouched, so both forms aggregate as one", async () => {
    expect(await rpc("metric_clean_utm_source", { raw: "METAxAM" })).toBe("METAxAM");
  });

  it("returns null for null and empty input", async () => {
    expect(await rpc("metric_clean_utm_source", { raw: null })).toBeNull();
    expect(await rpc("metric_clean_utm_source", { raw: "" })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/metric-helpers.test.ts`
Expected: FAIL — every case errors with a PostgREST "Could not find the function" message, because the migration has not been applied.

- [ ] **Step 4: Apply the migration**

Apply the file's contents to the live project with the Supabase MCP `apply_migration` tool: `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `metric_helper_functions`. The SQL is additive and creates no table, so it is safe to re-apply.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/metric-helpers.test.ts`
Expected: PASS, all cases.

If PostgREST reports the function is still missing after a successful apply, its schema cache has not reloaded — wait a few seconds and re-run before changing any code.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260809120000_metric_helper_functions.sql tests/metric-helpers.test.ts
git commit -m "feat(db): add shared metric extraction helper functions"
```

---

### Task 3: `v_sessions_attributed`

**Files:**
- Create: `supabase/migrations/20260809120100_v_sessions_attributed.sql`
- Create: `tests/v-sessions-attributed.test.ts`

**Interfaces:**
- Consumes: every `public.metric_*` function from Task 2.
- Produces: view `public.v_sessions_attributed` — all `sessions` columns plus `utm_source_clean text`, `ad_key text`, `ad_key_type text` (`'ad_id' | 'ad_name' | 'none'`), `campaign_key text`, `day_ist date`. Task 6 and Slice D read these column names.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809120100_v_sessions_attributed.sql`:

```sql
-- Normalized read layer over sessions. Adds the canonical ad key, the campaign
-- key, the repaired utm_source and the Asia/Kolkata day. Stores nothing and
-- changes no row — the repair runs on every read, which is what lets it correct
-- all history at once with no backfill.
--
-- security_invoker = true is load-bearing: without it the view would run as its
-- owner and silently bypass every RLS policy on sessions, which is a tenant
-- data leak.
--
-- Ad key source order: an identifier from the landing_url query string first,
-- then utm_content as a name match. ad_key_type records which, so the interface
-- can mark name matches as weak (a rename in Meta forks one ad into two).
create or replace view public.v_sessions_attributed
with (security_invoker = true) as
select
  s.*,
  public.metric_clean_utm_source(s.utm_source) as utm_source_clean,
  coalesce(
    public.metric_ad_id_from_url(s.landing_url),
    public.metric_normalize_key(s.utm_content)
  ) as ad_key,
  case
    when public.metric_ad_id_from_url(s.landing_url) is not null then 'ad_id'
    when public.metric_normalize_key(s.utm_content) is not null then 'ad_name'
    else 'none'
  end as ad_key_type,
  public.metric_campaign_id_from_url(s.landing_url) as campaign_key,
  (s.created_at at time zone 'Asia/Kolkata')::date as day_ist
from public.sessions s;

grant select on public.v_sessions_attributed to anon, authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/v-sessions-attributed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  adminClient,
  clientClient,
  countRows,
  expectStableEqualCounts,
} from "./helpers/supabase";

const VIEW = "v_sessions_attributed";

describe(`${VIEW} — shape and rules`, () => {
  it("returns exactly one row per session, adding and dropping none", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "sessions");
  });

  it("leaves no utm_source_clean carrying the leaked prefix", async () => {
    // Asserted in JS, not with .like(): the pattern would itself need the
    // underscore escaped, which is the exact trap this rule exists to avoid.
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("utm_source_clean")
      .not("utm_source_clean", "is", null)
      .limit(5000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.utm_source_clean.startsWith("utm_source=")).toBe(false);
    }
  });

  it("classifies every row as ad_id, ad_name or none, with the key agreeing", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, ad_key_type")
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(["ad_id", "ad_name", "none"]).toContain(row.ad_key_type);
      if (row.ad_key_type === "none") expect(row.ad_key).toBeNull();
      else expect(row.ad_key).not.toBeNull();
    }
  });

  it("emits only numeric identifiers when ad_key_type is ad_id", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key")
      .eq("ad_key_type", "ad_id")
      .limit(500);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  it("resolves real identifier-based ad keys for more than one client", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("client_id")
      .eq("ad_key_type", "ad_id")
      .limit(5000);
    if (error) throw new Error(error.message);
    const clients = new Set(data!.map((r) => r.client_id));
    expect(clients.size).toBeGreaterThanOrEqual(2);
  });

  it("never emits an unexpanded macro as an ad key", async () => {
    const admin = await adminClient();
    const { count, error } = await admin
      .from(VIEW)
      .select("*", { count: "exact", head: true })
      .ilike("ad_key", "%{{%");
    if (error) throw new Error(error.message);
    expect(count).toBe(0);
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
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/v-sessions-attributed.test.ts`
Expected: FAIL — the relation does not exist.

- [ ] **Step 4: Apply the migration**

Supabase MCP `apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `v_sessions_attributed`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/v-sessions-attributed.test.ts`
Expected: PASS.

The RLS pair is the important one. If the client identity's count equals admin's, `security_invoker` did not take effect — stop and report; do not relax the assertion.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260809120100_v_sessions_attributed.sql tests/v-sessions-attributed.test.ts
git commit -m "feat(db): add v_sessions_attributed read-layer view"
```

---

### Task 4: `v_payments_attributed`

**Files:**
- Create: `supabase/migrations/20260809120200_v_payments_attributed.sql`
- Create: `tests/v-payments-attributed.test.ts`

**Interfaces:**
- Consumes: every `public.metric_*` function from Task 2.
- Produces: view `public.v_payments_attributed` — all `payments` columns plus `utm_source_clean text`, `ad_key text`, `ad_key_type text`, `campaign_key text`, `is_paid boolean`, `is_test_payment boolean`, `is_test_client boolean`, `day_ist date`. Task 6 and Slice D read these column names.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809120200_v_payments_attributed.sql`:

```sql
-- Normalized read layer over payments.
--
-- The join to clients exists ONLY to derive the is_test_client boolean. It must
-- stay a projection of a single derived value: `select c.*` here would expose
-- razorpay_key_secret_enc / razorpay_webhook_secret_enc / tagmango_*_enc, which
-- are AES-256-GCM ciphertext this dashboard must never read. It is a LEFT join
-- so a payment can never vanish because its client row is invisible.
--
-- is_paid is `status = 'paid' OR paid_at IS NOT NULL` because a handful of rows
-- are paid with a null paid_at. day_ist prefers paid_at so revenue buckets on
-- the day the money arrived.
--
-- is_test_payment is a PAYMENT-level rule, not a product-level one: test
-- products get repriced to their real value after roughly five transactions,
-- so a product flag would retroactively misclassify that product's history.
-- payments.amount is sourced server-side at payment time, so those rows keep
-- the Rs 1 value permanently. Test rows stay visible and stay in totals —
-- they are badged, never filtered.
--
-- starts_with() rather than LIKE 'rzp\_test%' so the underscore cannot be
-- misread as a single-character wildcard.
create or replace view public.v_payments_attributed
with (security_invoker = true) as
select
  p.*,
  public.metric_clean_utm_source(p.utm_source) as utm_source_clean,
  coalesce(
    public.metric_ad_id_from_params(p.utm_params),
    public.metric_normalize_key(p.utm_params ->> 'utm_content')
  ) as ad_key,
  case
    when public.metric_ad_id_from_params(p.utm_params) is not null then 'ad_id'
    when public.metric_normalize_key(p.utm_params ->> 'utm_content') is not null then 'ad_name'
    else 'none'
  end as ad_key_type,
  public.metric_normalize_key(p.utm_params ->> 'utm_id') as campaign_key,
  (p.status = 'paid' or p.paid_at is not null) as is_paid,
  (p.amount <= 500) as is_test_payment,
  coalesce(starts_with(c.razorpay_key_id, 'rzp_test'), false) as is_test_client,
  (coalesce(p.paid_at, p.created_at) at time zone 'Asia/Kolkata')::date as day_ist
from public.payments p
left join public.clients c on c.id = p.client_id;

grant select on public.v_payments_attributed to anon, authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/v-payments-attributed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  adminClient,
  clientClient,
  countRows,
  expectStableEqualCounts,
} from "./helpers/supabase";

const VIEW = "v_payments_attributed";

describe(`${VIEW} — shape and rules`, () => {
  it("returns exactly one row per payment, adding and dropping none", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "payments");
  });

  it("never exposes an encrypted secret column", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("*").limit(1);
    if (error) throw new Error(error.message);
    const columns = Object.keys(data![0]);
    for (const column of columns) expect(column).not.toMatch(/_enc$/);
  });

  it("marks a payment at or below 500 paise as a test payment", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("amount, is_test_payment")
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.is_test_payment).toBe(row.amount <= 500);
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

  it("treats a paid status with a null paid_at as paid", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("status, paid_at, is_paid")
      .limit(1000);
    if (error) throw new Error(error.message);
    for (const row of data!) {
      expect(row.is_paid).toBe(row.status === "paid" || row.paid_at !== null);
    }
  });

  it("leaves no utm_source_clean carrying the leaked prefix", async () => {
    // Asserted in JS, not with .like(): the pattern would itself need the
    // underscore escaped, which is the exact trap this rule exists to avoid.
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

  it("emits only numeric identifiers when ad_key_type is ad_id", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key")
      .eq("ad_key_type", "ad_id")
      .limit(500);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
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
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/v-payments-attributed.test.ts`
Expected: FAIL — the relation does not exist.

- [ ] **Step 4: Apply the migration**

Supabase MCP `apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `v_payments_attributed`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/v-payments-attributed.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260809120200_v_payments_attributed.sql tests/v-payments-attributed.test.ts
git commit -m "feat(db): add v_payments_attributed read-layer view"
```

---

### Task 5: `v_funnel_by_session`

**Files:**
- Create: `supabase/migrations/20260809120300_v_funnel_by_session.sql`
- Create: `tests/v-funnel-by-session.test.ts`

**Interfaces:**
- Produces: view `public.v_funnel_by_session` — `session_id uuid`, `client_id uuid`, `product_id uuid`, `day_ist date`, and six booleans `reached_page_load`, `reached_form_open`, `reached_form_start`, `reached_form_submit`, `reached_payment_open`, `reached_payment_complete`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809120300_v_funnel_by_session.sql`:

```sql
-- One row per session with a boolean per funnel stage, computed as "reached
-- this stage OR any later stage" rather than "fired this event".
--
-- This is not a stylistic choice. The real event stream is not monotonic:
-- hundreds of sessions fire form_start with no form_open, and dozens reach
-- payment_complete with no form_open. Counting raw events makes later stages
-- exceed earlier ones and inverts the drop-off chart.
--
-- Built from sessions LEFT JOIN events, not from events alone, so the ~900
-- sessions that fired no event at all still get a row with every stage false.
-- Dropping them would understate top-of-funnel.
create or replace view public.v_funnel_by_session
with (security_invoker = true) as
select
  s.id as session_id,
  s.client_id,
  s.product_id,
  (s.created_at at time zone 'Asia/Kolkata')::date as day_ist,
  coalesce(bool_or(e.event_type in (
    'page_load', 'form_open', 'form_start', 'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_page_load,
  coalesce(bool_or(e.event_type in (
    'form_open', 'form_start', 'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_form_open,
  coalesce(bool_or(e.event_type in (
    'form_start', 'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_form_start,
  coalesce(bool_or(e.event_type in (
    'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_form_submit,
  coalesce(bool_or(e.event_type in (
    'payment_open', 'payment_complete'
  )), false) as reached_payment_open,
  coalesce(bool_or(e.event_type = 'payment_complete'), false) as reached_payment_complete
from public.sessions s
left join public.events e on e.session_id = s.id
group by s.id, s.client_id, s.product_id, s.created_at;

grant select on public.v_funnel_by_session to anon, authenticated;
```

- [ ] **Step 2: Write the failing test**

`tests/v-funnel-by-session.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/v-funnel-by-session.test.ts`
Expected: FAIL — the relation does not exist.

- [ ] **Step 4: Apply the migration**

Supabase MCP `apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `v_funnel_by_session`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/v-funnel-by-session.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260809120300_v_funnel_by_session.sql tests/v-funnel-by-session.test.ts
git commit -m "feat(db): add v_funnel_by_session with reached-or-beyond semantics"
```

---

### Task 6: Named metrics and the Unattributed bucket

Pure TypeScript. No database access — these are unit-tested in isolation, and they are the only place the two metric names and the Unattributed label are defined.

**Files:**
- Create: `src/lib/metrics/definitions.ts`
- Create: `src/lib/metrics/attribution.ts`
- Create: `tests/metrics-definitions.test.ts`
- Create: `tests/metrics-attribution.test.ts`

**Interfaces:**
- Produces:
  - `CONVERSION_RATE_LABEL`, `CHECKOUT_COMPLETION_LABEL` (string constants)
  - `conversionRate(paidPayments: number, sessions: number): number | null`
  - `checkoutCompletion(paidPayments: number, paymentAttempts: number): number | null`
  - `UNATTRIBUTED_LABEL: string`
  - `groupWithUnattributed<T>(rows: T[], keyOf: (row: T) => string | null | undefined, valueOf: (row: T) => number): AttributedGroup[]`
  - `type AttributedGroup = { key: string | null; label: string; value: number; isUnattributed: boolean }`
- Slice D consumes all of these.

- [ ] **Step 1: Write the failing metric-definition test**

`tests/metrics-definitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_COMPLETION_LABEL,
  CONVERSION_RATE_LABEL,
  checkoutCompletion,
  conversionRate,
} from "@/lib/metrics/definitions";

describe("metric labels (AC-3)", () => {
  it("names the two metrics distinctly and never as bare 'conversion'", () => {
    expect(CONVERSION_RATE_LABEL).toBe("Conversion rate");
    expect(CHECKOUT_COMPLETION_LABEL).toBe("Checkout completion");
    expect(CONVERSION_RATE_LABEL).not.toBe(CHECKOUT_COMPLETION_LABEL);
    for (const label of [CONVERSION_RATE_LABEL, CHECKOUT_COMPLETION_LABEL]) {
      expect(label.toLowerCase()).not.toBe("conversion");
    }
  });
});

describe("conversionRate — paid payments over sessions", () => {
  it("computes the ratio", () => {
    expect(conversionRate(465, 8180)).toBeCloseTo(0.05684, 5);
  });

  it("returns null rather than Infinity or NaN when there are no sessions", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(5, 0)).toBeNull();
  });

  it("returns 0 when there are sessions but no paid payments", () => {
    expect(conversionRate(0, 100)).toBe(0);
  });
});

describe("checkoutCompletion — paid payments over all attempts", () => {
  it("computes the ratio", () => {
    expect(checkoutCompletion(465, 712)).toBeCloseTo(0.65309, 5);
  });

  it("differs from conversionRate on the same paid count", () => {
    expect(checkoutCompletion(465, 712)).not.toBe(conversionRate(465, 8180));
  });

  it("returns null rather than Infinity or NaN when there are no attempts", () => {
    expect(checkoutCompletion(0, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing attribution test**

`tests/metrics-attribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  UNATTRIBUTED_LABEL,
  groupWithUnattributed,
} from "@/lib/metrics/attribution";

type Row = { adKey: string | null; revenue: number };

const rows: Row[] = [
  { adKey: "120242114093820519", revenue: 9900 },
  { adKey: "120242114093820519", revenue: 9900 },
  { adKey: "120246979966760", revenue: 4900 },
  { adKey: null, revenue: 9900 },
  { adKey: null, revenue: 100 },
];

const byAdKey = (row: Row) => row.adKey;
const byRevenue = (row: Row) => row.revenue;

describe("groupWithUnattributed (AC-5, AC-20)", () => {
  it("reconciles: grouped rows plus Unattributed equal the ungrouped total", () => {
    const groups = groupWithUnattributed(rows, byAdKey, byRevenue);
    const total = rows.reduce((sum, row) => sum + row.revenue, 0);
    expect(groups.reduce((sum, group) => sum + group.value, 0)).toBe(total);
  });

  it("emits exactly one explicit Unattributed row rather than dropping rows", () => {
    const groups = groupWithUnattributed(rows, byAdKey, byRevenue);
    const unattributed = groups.filter((group) => group.isUnattributed);
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0].label).toBe(UNATTRIBUTED_LABEL);
    expect(unattributed[0].value).toBe(10000);
    expect(unattributed[0].key).toBeNull();
  });

  it("sums rows sharing a key", () => {
    const groups = groupWithUnattributed(rows, byAdKey, byRevenue);
    const group = groups.find((g) => g.key === "120242114093820519");
    expect(group?.value).toBe(19800);
  });

  it("still emits an Unattributed row when nothing is unattributed, so totals line up", () => {
    const allAttributed: Row[] = [{ adKey: "120111222333", revenue: 100 }];
    const groups = groupWithUnattributed(allAttributed, byAdKey, byRevenue);
    expect(groups.filter((g) => g.isUnattributed)).toHaveLength(1);
    expect(groups.find((g) => g.isUnattributed)?.value).toBe(0);
  });

  it("treats empty and whitespace-only keys as unattributed", () => {
    const messy: Row[] = [
      { adKey: "", revenue: 10 },
      { adKey: "   ", revenue: 20 },
      { adKey: null, revenue: 30 },
    ];
    const groups = groupWithUnattributed(messy, byAdKey, byRevenue);
    expect(groups).toHaveLength(1);
    expect(groups[0].isUnattributed).toBe(true);
    expect(groups[0].value).toBe(60);
  });

  it("sorts attributed groups by descending value, keeping Unattributed last", () => {
    const groups = groupWithUnattributed(rows, byAdKey, byRevenue);
    expect(groups[groups.length - 1].isUnattributed).toBe(true);
    const attributed = groups.filter((g) => !g.isUnattributed);
    for (let i = 1; i < attributed.length; i++) {
      expect(attributed[i - 1].value).toBeGreaterThanOrEqual(attributed[i].value);
    }
  });

  it("returns only the zero Unattributed row for empty input", () => {
    const groups = groupWithUnattributed([] as Row[], byAdKey, byRevenue);
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe(0);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npm test -- tests/metrics-definitions.test.ts tests/metrics-attribution.test.ts`
Expected: FAIL — both modules are unresolved.

- [ ] **Step 4: Write `src/lib/metrics/definitions.ts`**

```ts
/**
 * The two conversion rates, named separately and deliberately.
 *
 * They answer different questions: sessions-to-paid measures the ad and the
 * landing page, attempts-to-paid measures the checkout. Publishing only one
 * would hide either ad quality or a payment gateway problem, so neither may
 * ever be labelled simply "conversion".
 */
export const CONVERSION_RATE_LABEL = "Conversion rate";
export const CHECKOUT_COMPLETION_LABEL = "Checkout completion";

/** Ratio in 0..1, or null when the denominator is zero — never NaN or Infinity. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** Paid payments divided by sessions. */
export function conversionRate(
  paidPayments: number,
  sessions: number
): number | null {
  return ratio(paidPayments, sessions);
}

/** Paid payments divided by all payment attempts. */
export function checkoutCompletion(
  paidPayments: number,
  paymentAttempts: number
): number | null {
  return ratio(paidPayments, paymentAttempts);
}
```

- [ ] **Step 5: Write `src/lib/metrics/attribution.ts`**

```ts
/**
 * Grouping helper that guarantees a breakdown reconciles to its real total.
 *
 * Rows resolving no key are collected into one explicit Unattributed group
 * rather than filtered out, and that group is emitted even when it is empty,
 * so every breakdown satisfies: grouped rows + Unattributed = ungrouped total.
 * A row attributed at campaign level but not at ad level lands here in an ad
 * level rollup and in a real group in a campaign level rollup; both are true.
 */
export const UNATTRIBUTED_LABEL = "Unattributed";

export type AttributedGroup = {
  key: string | null;
  label: string;
  value: number;
  isUnattributed: boolean;
};

export function groupWithUnattributed<T>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined,
  valueOf: (row: T) => number
): AttributedGroup[] {
  const attributed = new Map<string, number>();
  let unattributed = 0;

  for (const row of rows) {
    const key = keyOf(row)?.trim();
    const value = valueOf(row);
    if (!key) {
      unattributed += value;
      continue;
    }
    attributed.set(key, (attributed.get(key) ?? 0) + value);
  }

  const groups: AttributedGroup[] = [...attributed.entries()]
    .map(([key, value]) => ({ key, label: key, value, isUnattributed: false }))
    .sort((a, b) => b.value - a.value);

  groups.push({
    key: null,
    label: UNATTRIBUTED_LABEL,
    value: unattributed,
    isUnattributed: true,
  });

  return groups;
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npm test -- tests/metrics-definitions.test.ts tests/metrics-attribution.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: every test passes, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/metrics tests/metrics-definitions.test.ts tests/metrics-attribution.test.ts
git commit -m "feat: add named metrics and Unattributed grouping helper"
```

---

## Acceptance criteria coverage

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | `utm_source=` prefix aggregates under the clean label | Task 2 (`metric_clean_utm_source`), Tasks 3 & 4 (`utm_source_clean`) |
| AC-2 | Payments ≤ 500 paise and `rzp_test` clients marked, still visible | Task 4 (`is_test_payment`, `is_test_client`) |
| AC-3 | Two separately named metrics, neither called "conversion" | Task 6 (`definitions.ts`) |
| AC-4 | Canonical ad key with identifier-vs-name match type | Task 2 (extraction functions), Tasks 3 & 4 (`ad_key`, `ad_key_type`) |
| AC-5 | Unattributed bucket, never silently dropped | Task 6 (`groupWithUnattributed`) |
| AC-6 | Every view returns only the caller's rows unless admin | Tasks 3, 4, 5 (`security_invoker` + RLS test pairs) |
| AC-20 | Campaign-tier rows counted at campaign level, Unattributed at ad level | Tasks 3 & 4 (`campaign_key`), Task 6 (grouping by either key) |

## Out of scope for this slice

- Joining `ad_key` / `campaign_key` to a real `ads` table — that table arrives in Slice B (child 02). Until then the keys are resolved but unmatched, which is exactly the intended intermediate state.
- Any UI. The Ads section is Slice D (child 03).
- Fixing the `utm_source=` capture bug at source, which lives in the Trace repo.

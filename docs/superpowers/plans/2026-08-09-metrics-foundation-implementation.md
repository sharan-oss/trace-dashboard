# Metrics Foundation (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Postgres read layer (helper functions + three views) plus a typed query layer that makes Trace's existing session/payment/event data trustworthy — normalized UTM sources, marked test rows, a canonical ad key, two separately named metrics, and an explicit Unattributed bucket.

**Architecture:** All data logic lives in Postgres. Immutable `public.metric_*` SQL functions hold the single definition of every extraction rule; three `security_invoker` views compose them over `sessions`, `payments` and `events`. A thin TypeScript layer under `src/lib/metrics/` holds only pure presentation-side arithmetic (the two named metrics, the Unattributed grouping helper). Nothing writes to Trace's tables.

**Tech Stack:** Postgres 17.6 (Supabase project `ggfkbcdegkpqrjmqjfyw`), `@supabase/supabase-js` ^2.108.2, TypeScript strict, Vitest (added by Task 1) running in a Node environment against the live database under real RLS-scoped JWTs.

Source spec: [`docs/superpowers/specs/2026-08-09-meta-ads-attribution/01-metrics-foundation.md`](../specs/2026-08-09-meta-ads-attribution/01-metrics-foundation.md). Acceptance criteria AC-1 to AC-6 and AC-20 live in the umbrella [`index.md`](../specs/2026-08-09-meta-ads-attribution/index.md).

---

## Spec corrections verified against the live database on 2026-08-09

> **Partly superseded — read "Plan revision" below before acting on this section.** These corrections were measured before Sharan's Love School normalisation shipped. Points 2 to 6 still hold and still bind. Point 1 has been overtaken by events: the ad identifiers it found are now stored in dedicated columns, and coverage went from 34% to 94%. Tasks 1 and 2 were built against this section; Tasks 3 to 7 were rewritten against the revision.

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

## Plan revision — 2026-08-09, after the Love School normalisation

Tasks 1 and 2 are complete and merged into the branch. Everything below was rewritten after Sharan shipped four migrations (`ads_dimension_table`, `seed_love_school_ads`, `meta_id_columns_on_sessions_payments`, `backfill_love_school_meta_ids`) and revised child spec 01 from two-tier to three-tier attribution. The original Tasks 3 to 6 are superseded.

**What changed in the world, verified live before rewriting:**

- `public.ads` exists, is RLS-protected correctly (read: `is_admin` OR own `client_id`; insert and update: `is_admin` only, with `WITH CHECK`), and holds Love School's full hierarchy — 67 ads, 19 ad sets, 9 campaigns, zero incomplete rows.
- `sessions` and `payments` carry additive nullable text columns `campaign_id`, `adset_id`, `ad_id`. Love School was backfilled: 7,745 of 8,238 sessions (94%) and 668 of 716 payments now carry an exact ad id. Referential integrity confirmed — zero session `ad_id` values missing from `ads`, zero rows disagreeing with `ads` on adset or campaign.
- **Occultyogis Vastu has zero stored ids and zero rows in `ads`**, but 2,018 of 2,401 sessions and 228 of 248 payments carry an extractable ad id in their raw parameters. The views must therefore resolve an ad key from extraction even when `ads` has no matching row, degrading only the names and the hierarchy. This is the single most important test case in the rewrite, and it is why every join to `ads` is a LEFT join.
- Sharan's new URL template is already live on 1,043 sessions. **29 of them carry `campaign_id=` with no `utm_id=`, and the shipped `metric_campaign_id_from_url` misses every one** because it reads only `utm_id`. That count grows as the template rolls out.
- `fbc_id` is present on 2,037 sessions and numeric `utm_term` on 4,695; where both appear they never disagree (0 of 1,973), so a single scan-and-filter ad set helper is safe.
- Ad names are genuinely unsafe to match unscoped: 14 of Love School's 49 names are reused across ads, and one name is duplicated **inside a single campaign**. That last row must resolve to no ad at all rather than guess.

**Additional Global Constraints introduced by this revision** (they bind every task below, on top of the original Global Constraints section):

- **Attribution reads `coalesce(stored id, extracted id)`.** Stored columns win; extraction is the bridge for rows that arrived after the backfill and for clients never backfilled. Never read only one source.
- **The three tiers are ad, then ad set, then campaign.** A row is attributed at the most specific tier that resolves. A row attributed at ad set level is Unattributed at ad level; both statements are true simultaneously and both must hold.
- **Ad names resolve only when unique within the row's campaign**, scoped to the row's own client. A name still ambiguous after scoping resolves nothing at ad level — it keeps whatever ad set or campaign tier resolved and appears in the ad-level Unattributed bucket. Never break a tie arbitrarily.
- **Ids always beat names.** A name match is only ever attempted when no id resolved.
- **Every join to `ads` is a LEFT join** and must not multiply rows. A client with no seeded ads must still get ad keys from extraction.
- `metric_normalize_ad_id` is the generic numeric Meta-id guard — it is correct to use it for ad set ids too. It is deliberately NOT used for campaign ids, because the test client legitimately uses the non-numeric campaign id `june-test-01`.

---

### Task 3: Extend the metric helpers for ad set and the widened campaign key

Adds ad set extraction and fixes the campaign extraction gap that is already losing rows. Pure additive SQL, composing the existing normalizers — no regex is re-derived.

**Files:**
- Create: `supabase/migrations/20260809140000_metric_helpers_adset_and_campaign.sql`
- Modify: `tests/metric-helpers.test.ts` (add new describe blocks; leave existing cases untouched)

**Interfaces:**
- Consumes: `public.metric_normalize_ad_id(text)`, `public.metric_normalize_key(text)` from Task 2.
- Produces (all `immutable`, `parallel safe`, granted execute to `anon` and `authenticated`, callable over RPC):
  - `public.metric_campaign_id_key_pattern() -> text`
  - `public.metric_adset_id_key_pattern() -> text`
  - `public.metric_campaign_id_from_url(url text) -> text` (REPLACED — widened, signature and parameter name unchanged)
  - `public.metric_campaign_id_from_params(params jsonb) -> text`
  - `public.metric_adset_id_from_url(url text) -> text`
  - `public.metric_adset_id_from_params(params jsonb) -> text`
- Tasks 4 and 5 compose these. They must never re-implement an extraction rule inline.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809140000_metric_helpers_adset_and_campaign.sql`:

```sql
-- Ad set extraction, plus the campaign key widened to the new URL template.
--
-- WHY THE CAMPAIGN WIDENING IS URGENT: the original helper read only utm_id.
-- Sharan's standard template emits campaign_id={{campaign.id}}, and 29 live
-- sessions already carry campaign_id with no utm_id. Every one of them resolves
-- no campaign today, and that count grows with every ad that adopts the template.
--
-- WHY utm_term NEEDS THE NUMERIC GUARD: utm_term provably carries the ad set ID
-- in one template era and the ad set NAME in another. The numeric guard is the
-- only thing separating them. Without it, ad set names would be joined against
-- ad set ids and resolve nothing while looking attributed.
--
-- fbc_id is the AD SET id. It is NOT fbclid, which is Meta's click id. The
-- anchored patterns keep them apart -- never use LIKE '%fbc_id%', which matches
-- fbclid because `_` is a single-character wildcard in LIKE.
--
-- Both extractors use the same scan-then-filter shape as metric_ad_id_from_url:
-- take the first value that passes the guard, not the first key that matches.

-- Campaign id key variants. The new template emits `campaign_id`; older rows
-- carry `utm_id`. Both mean the Meta campaign id.
create or replace function public.metric_campaign_id_key_pattern()
returns text language sql immutable parallel safe as $$
  select '(?:utm_id|campaign_id)'
$$;

-- Ad set id key variants. fbc_id is what both the old and the new template
-- emit; adset_id is accepted for symmetry; utm_term is the legacy era and is
-- only trusted when it passes the numeric guard.
create or replace function public.metric_adset_id_key_pattern()
returns text language sql immutable parallel safe as $$
  select '(?:fbc_id|adset_id|utm_term)'
$$;

-- Campaign id from a URL query string. Junk filter only, NO numeric guard:
-- campaign ids are numeric for the paying clients, but the test client
-- legitimately uses 'june-test-01'. Requiring digits would silently drop it.
create or replace function public.metric_campaign_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(m[1])
  from regexp_matches(
    url,
    '[?&]' || public.metric_campaign_id_key_pattern() || '=([^&#]*)',
    'gi'
  ) as m
  where public.metric_normalize_key(m[1]) is not null
  limit 1
$$;

-- Campaign id from the jsonb params. Only the named keys are ever read: the
-- utm_params key space is unbounded because campaign names leak in as keys,
-- so nothing may enumerate keys generically.
create or replace function public.metric_campaign_id_from_params(params jsonb)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_key(e.value)
  from jsonb_each_text(
    case when jsonb_typeof(params) = 'object' then params else '{}'::jsonb end
  ) as e
  where e.key ~* ('^' || public.metric_campaign_id_key_pattern() || '$')
    and public.metric_normalize_key(e.value) is not null
  limit 1
$$;

-- Ad set id from a URL query string. Numeric guard applies to every variant,
-- which is what makes reading utm_term safe.
create or replace function public.metric_adset_id_from_url(url text)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(m[1])
  from regexp_matches(
    url,
    '[?&]' || public.metric_adset_id_key_pattern() || '=([^&#]*)',
    'gi'
  ) as m
  where public.metric_normalize_ad_id(m[1]) is not null
  limit 1
$$;

-- Ad set id from the jsonb params.
create or replace function public.metric_adset_id_from_params(params jsonb)
returns text language sql immutable parallel safe as $$
  select public.metric_normalize_ad_id(e.value)
  from jsonb_each_text(
    case when jsonb_typeof(params) = 'object' then params else '{}'::jsonb end
  ) as e
  where e.key ~* ('^' || public.metric_adset_id_key_pattern() || '$')
    and public.metric_normalize_ad_id(e.value) is not null
  limit 1
$$;

grant execute on function
  public.metric_campaign_id_key_pattern(),
  public.metric_adset_id_key_pattern(),
  public.metric_campaign_id_from_url(text),
  public.metric_campaign_id_from_params(jsonb),
  public.metric_adset_id_from_url(text),
  public.metric_adset_id_from_params(jsonb)
to anon, authenticated;
```

- [ ] **Step 2: Write the failing tests**

Append these describe blocks to `tests/metric-helpers.test.ts`. Do not modify the existing cases — the widened campaign function must still satisfy every one of them.

```ts
describe("metric_campaign_id_from_url — widened to the new template", () => {
  it("still reads a legacy utm_id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?utm_id=120987654321" })
    ).toBe("120987654321");
  });

  it("reads campaign_id, which the new template emits and the old helper missed", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?campaign_id=120235128175530519" })
    ).toBe("120235128175530519");
  });

  it("still preserves a non-numeric campaign id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?campaign_id=june-test-01" })
    ).toBe("june-test-01");
  });

  it("skips a junk value to find a valid campaign id later in the string", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", {
        url: "https://x.com/?utm_id=%7b%7bcampaign.id%7d%7d&campaign_id=120235128175530519",
      })
    ).toBe("120235128175530519");
  });

  it("does not match fbclid or fbc_id", async () => {
    expect(
      await rpc("metric_campaign_id_from_url", { url: "https://x.com/?fbclid=120999888777&fbc_id=120555444333" })
    ).toBeNull();
  });
});

describe("metric_campaign_id_from_params", () => {
  it("reads utm_id", async () => {
    expect(await rpc("metric_campaign_id_from_params", { params: { utm_id: "120987654321" } })).toBe(
      "120987654321"
    );
  });

  it("reads campaign_id", async () => {
    expect(
      await rpc("metric_campaign_id_from_params", { params: { campaign_id: "120235128175530519" } })
    ).toBe("120235128175530519");
  });

  it("rejects an unexpanded macro", async () => {
    expect(
      await rpc("metric_campaign_id_from_params", { params: { utm_id: "{{campaign.id}}" } })
    ).toBeNull();
  });

  it("ignores fbc_id, which is an ad set id, not a campaign id", async () => {
    expect(
      await rpc("metric_campaign_id_from_params", { params: { fbc_id: "120555444333" } })
    ).toBeNull();
  });
});

describe("metric_adset_id_from_url", () => {
  it("reads fbc_id, the ad set id both templates emit", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?fbc_id=120237239322730519" })
    ).toBe("120237239322730519");
  });

  it("reads a numeric utm_term, the legacy ad set id era", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?utm_term=120237239322730519" })
    ).toBe("120237239322730519");
  });

  it("rejects a non-numeric utm_term, which is an ad set NAME, not an id", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?utm_term=OTG+-+15%2F1%2F2026" })
    ).toBeNull();
  });

  it("prefers a valid id over a name when both eras appear together", async () => {
    expect(
      await rpc("metric_adset_id_from_url", {
        url: "https://x.com/?utm_term=OTG+-+15%2F1%2F2026&fbc_id=120237239322730519",
      })
    ).toBe("120237239322730519");
  });

  it("does not match fbclid (the LIKE underscore-wildcard trap)", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?fbclid=120999888777" })
    ).toBeNull();
  });

  it("rejects an unexpanded macro", async () => {
    expect(
      await rpc("metric_adset_id_from_url", { url: "https://x.com/?fbc_id=%7b%7badset.id%7d%7d" })
    ).toBeNull();
  });
});

describe("metric_adset_id_from_params", () => {
  it("reads fbc_id", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { fbc_id: "120237239322730519" } })
    ).toBe("120237239322730519");
  });

  it("reads a numeric utm_term", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { utm_term: "120237239322730519" } })
    ).toBe("120237239322730519");
  });

  it("rejects a non-numeric utm_term", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { utm_term: "OTG - 15/1/2026" } })
    ).toBeNull();
  });

  it("never returns the ad id when only an ad id is present", async () => {
    expect(
      await rpc("metric_adset_id_from_params", { params: { h_ad_id: "120242114093820519" } })
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/metric-helpers.test.ts`
Expected: the four new describe blocks fail. The `campaign_id` cases fail because the shipped function reads only `utm_id`; the ad set cases fail with a PostgREST "Could not find the function" error.

- [ ] **Step 4: Apply the migration**

Load the MCP tools with `ToolSearch` query `select:mcp__claude_ai_Supabase__apply_migration`, then call `mcp__claude_ai_Supabase__apply_migration` with `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `metric_helpers_adset_and_campaign`, and the file contents as `query`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/metric-helpers.test.ts`
Expected: PASS, including every pre-existing case. If a pre-existing campaign test now fails, the widening broke backward compatibility — fix the function, never the old test.

- [ ] **Step 6: Verify the real-data gap actually closed**

Load `select:mcp__claude_ai_Supabase__execute_sql` and run, read-only:

```sql
select count(*) filter (where public.metric_campaign_id_from_url(landing_url) is null
                          and landing_url ~* '[?&]campaign_id=') as still_missed,
       count(*) filter (where public.metric_adset_id_from_url(landing_url) is not null) as adset_resolvable
from sessions;
```

Expected: `still_missed` is 0 (it was 29 before this task), and `adset_resolvable` is in the low thousands. Record both numbers in your report.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add supabase/migrations/20260809140000_metric_helpers_adset_and_campaign.sql tests/metric-helpers.test.ts
git commit -m "feat(db): add ad set extraction and widen campaign key to the new template"
```

---

### Task 4: `v_sessions_attributed`

The three-tier view over sessions. This is the most intricate task in the plan.

**Files:**
- Create: `supabase/migrations/20260809140100_v_sessions_attributed.sql`
- Create: `tests/v-sessions-attributed.test.ts`

**Interfaces:**
- Consumes: every `public.metric_*` function from Tasks 2 and 3; the `public.ads` table.
- Produces: view `public.v_sessions_attributed` — all `sessions` columns plus `utm_source_clean text`, `ad_key text`, `ad_key_type text` (`'ad_id' | 'ad_name' | 'none'`), `adset_key text`, `campaign_key text`, `attribution_tier text` (`'ad' | 'adset' | 'campaign' | 'none'`), `ad_name text`, `adset_name text`, `campaign_name text`, `day_ist date`. Task 7 and Slice D read these names.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809140100_v_sessions_attributed.sql`:

```sql
-- Three-tier attributed read layer over sessions.
--
-- security_invoker = true is load-bearing: without it the view runs as its
-- owner and silently bypasses RLS on sessions and ads, which is a tenant leak.
--
-- KEY RESOLUTION, in strict order:
--   1. The stored column (backfilled once for Love School, and eventually
--      written by Trace's capture) wins.
--   2. Otherwise extract from the raw landing_url via the shared metric_*
--      functions. This is what carries every client that was never backfilled
--      -- Occultyogis has zero stored ids but ~2,000 extractable ad ids -- and
--      every row that arrived after the backfill.
--   3. Only if no id resolved at all, fall back to a campaign-scoped ad NAME.
--
-- WHY THE NAME MATCH IS SCOPED: ad names are not unique. 14 of Love School's
-- 49 names are reused across ads, and one name is duplicated inside a single
-- campaign. name_in_campaign therefore keeps only names mapping to exactly one
-- ad within one campaign for one client; anything ambiguous resolves nothing
-- and lands in the ad-level Unattributed bucket rather than being guessed.
-- The client_id in the grouping key matters: without it an admin, who can see
-- every client's ads, could match one client's name against another's ad.
--
-- EVERY JOIN TO ads IS A LEFT JOIN. A client with no seeded ads (Occultyogis
-- today) must still resolve ad keys from extraction; only the display names and
-- the completed hierarchy degrade to null. Both joins are on unique or
-- deduplicated keys, so neither can multiply rows.
create or replace view public.v_sessions_attributed
with (security_invoker = true) as
with name_in_campaign as (
  select client_id, meta_campaign_id, ad_name, min(meta_ad_id) as meta_ad_id
  from public.ads
  where ad_name is not null and meta_campaign_id is not null
  group by client_id, meta_campaign_id, ad_name
  having count(distinct meta_ad_id) = 1
),
resolved as (
  select
    s.*,
    coalesce(s.ad_id, public.metric_ad_id_from_url(s.landing_url)) as ad_id_resolved,
    coalesce(s.adset_id, public.metric_adset_id_from_url(s.landing_url)) as adset_id_resolved,
    coalesce(s.campaign_id, public.metric_campaign_id_from_url(s.landing_url)) as campaign_id_resolved,
    public.metric_normalize_key(s.utm_content) as ad_name_raw
  from public.sessions s
),
keyed as (
  select
    r.*,
    nic.meta_ad_id as ad_id_from_name
  from resolved r
  left join name_in_campaign nic
    on r.ad_id_resolved is null
   and nic.client_id = r.client_id
   and nic.meta_campaign_id = r.campaign_id_resolved
   and nic.ad_name = r.ad_name_raw
)
select
  k.id, k.client_id, k.product_id, k.fingerprint,
  k.utm_source, k.utm_medium, k.utm_campaign, k.utm_content, k.utm_term,
  k.fbclid, k.gclid, k.campaign_id, k.adset_id, k.ad_id,
  k.referrer, k.landing_url,
  k.device_ram_gb, k.device_cpu_cores, k.device_brand, k.device_model,
  k.device_os, k.device_os_version,
  k.network_type, k.network_speed_kbps, k.fcp_ms, k.tti_ms,
  k.created_at,
  public.metric_clean_utm_source(k.utm_source) as utm_source_clean,
  coalesce(k.ad_id_resolved, k.ad_id_from_name) as ad_key,
  case
    when k.ad_id_resolved is not null then 'ad_id'
    when k.ad_id_from_name is not null then 'ad_name'
    else 'none'
  end as ad_key_type,
  coalesce(k.adset_id_resolved, a.meta_adset_id) as adset_key,
  coalesce(k.campaign_id_resolved, a.meta_campaign_id) as campaign_key,
  case
    when coalesce(k.ad_id_resolved, k.ad_id_from_name) is not null then 'ad'
    when coalesce(k.adset_id_resolved, a.meta_adset_id) is not null then 'adset'
    when coalesce(k.campaign_id_resolved, a.meta_campaign_id) is not null then 'campaign'
    else 'none'
  end as attribution_tier,
  a.ad_name,
  a.adset_name,
  a.campaign_name,
  (k.created_at at time zone 'Asia/Kolkata')::date as day_ist
from keyed k
left join public.ads a
  on a.meta_ad_id = coalesce(k.ad_id_resolved, k.ad_id_from_name)
 and a.client_id = k.client_id;

grant select on public.v_sessions_attributed to anon, authenticated;
```

Note: the column list is spelled out rather than using `s.*` because the CTE adds working columns that must not leak into the view's output. If `sessions` has a column not in this list, add it — the view must expose every base column plus the derived ones. Verify with the query in Step 3.

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

describe(`${VIEW} — shape`, () => {
  it("returns exactly one row per session, adding and dropping none", async () => {
    await expectStableEqualCounts(await adminClient(), VIEW, "sessions");
  });

  it("exposes every base sessions column alongside the derived ones", async () => {
    const admin = await adminClient();
    const [viewRow, tableRow] = await Promise.all([
      admin.from(VIEW).select("*").limit(1).single(),
      admin.from("sessions").select("*").limit(1).single(),
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

  it("leaves no utm_source_clean carrying the leaked prefix", async () => {
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
});

describe(`${VIEW} — key resolution`, () => {
  it("classifies every row as ad_id, ad_name or none, with the key agreeing", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("ad_key, ad_key_type").limit(3000);
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
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  it("prefers the stored id over extraction — every stored ad_id survives into ad_key", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_id, ad_key, ad_key_type")
      .not("ad_id", "is", null)
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.ad_key).toBe(row.ad_id);
      expect(row.ad_key_type).toBe("ad_id");
    }
  });

  it("resolves ad keys by extraction for a client with no stored ids and no seeded ads", async () => {
    // Occultyogis Vastu: zero stored ids, zero rows in `ads`, but ~2,000
    // extractable ad ids. This is the regression that would break a design
    // reading only stored columns or requiring an `ads` row to exist.
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("client_id, ad_key, ad_key_type, ad_name")
      .is("ad_id", null)
      .eq("ad_key_type", "ad_id")
      .limit(2000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.ad_key).toMatch(/^[0-9]{6,}$/);
  });

  it("never resolves an ad name that is ambiguous within its campaign", async () => {
    const admin = await adminClient();
    const { data: ads, error: adsError } = await admin
      .from("ads")
      .select("client_id, meta_campaign_id, ad_name, meta_ad_id");
    if (adsError) throw new Error(adsError.message);

    const counts = new Map<string, Set<string>>();
    for (const ad of ads!) {
      const key = `${ad.client_id}|${ad.meta_campaign_id}|${ad.ad_name}`;
      if (!counts.has(key)) counts.set(key, new Set());
      counts.get(key)!.add(ad.meta_ad_id);
    }
    const ambiguous = [...counts.entries()].filter(([, ids]) => ids.size > 1);
    expect(ambiguous.length).toBeGreaterThan(0); // the fixture this test needs exists

    const { data: named, error } = await admin
      .from(VIEW)
      .select("client_id, campaign_key, utm_content, ad_key")
      .eq("ad_key_type", "ad_name")
      .limit(3000);
    if (error) throw new Error(error.message);
    const ambiguousKeys = new Set(ambiguous.map(([key]) => key));
    for (const row of named!) {
      expect(ambiguousKeys.has(`${row.client_id}|${row.campaign_key}|${row.utm_content}`)).toBe(
        false
      );
    }
  });

  it("only ever name-matches a row that resolved no id", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_id, ad_key_type")
      .eq("ad_key_type", "ad_name")
      .limit(2000);
    if (error) throw new Error(error.message);
    for (const row of data!) expect(row.ad_id).toBeNull();
  });
});

describe(`${VIEW} — three-tier attribution`, () => {
  it("assigns the most specific tier that resolved", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, adset_key, campaign_key, attribution_tier")
      .limit(3000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
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

  it("resolves all three tiers for at least some rows", async () => {
    const admin = await adminClient();
    for (const tier of ["ad", "adset", "campaign"]) {
      const { count, error } = await admin
        .from(VIEW)
        .select("*", { count: "exact", head: true })
        .eq("attribution_tier", tier);
      if (error) throw new Error(error.message);
      expect(count, `expected at least one row at tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("fills the hierarchy from ads whenever the ad resolved to a seeded ad", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, adset_key, campaign_key, ad_name, campaign_name")
      .not("ad_name", "is", null)
      .limit(1000);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row.adset_key).not.toBeNull();
      expect(row.campaign_key).not.toBeNull();
      expect(row.campaign_name).not.toBeNull();
    }
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
    const { data, error } = await client.from(VIEW).select("client_id").limit(3000);
    if (error) throw new Error(error.message);
    expect(new Set(data!.map((r) => r.client_id)).size).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/v-sessions-attributed.test.ts`
Expected: FAIL — the relation does not exist.

Before applying, confirm your column list is complete. Load `select:mcp__claude_ai_Supabase__execute_sql` and run:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='sessions'
order by ordinal_position;
```

Every column returned must appear in the view's select list.

- [ ] **Step 4: Apply the migration**

`mcp__claude_ai_Supabase__apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `v_sessions_attributed`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/v-sessions-attributed.test.ts`
Expected: PASS.

The RLS pair and the row-count equality are the ones that must never be relaxed. If the client count equals the admin count, `security_invoker` did not take effect. If the view has more rows than `sessions`, a join is multiplying rows — fix the join, do not add a `distinct`.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add supabase/migrations/20260809140100_v_sessions_attributed.sql tests/v-sessions-attributed.test.ts
git commit -m "feat(db): add v_sessions_attributed with three-tier attribution"
```

---

### Task 5: `v_payments_attributed`

The same three-tier resolution over payments, sourcing from `utm_params` instead of a URL, plus the test-row marking.

**Files:**
- Rename: `supabase/migrations/20260809140200_v_ad_name_resolution.sql` → `supabase/migrations/20260809140050_v_ad_name_resolution.sql`
- Create: `supabase/migrations/20260809140300_v_payments_attributed.sql`
- Create: `tests/v-payments-attributed.test.ts`

- [ ] **Step 0: Fix the migration ordering bug left by Task 4**

`v_sessions_attributed` (`20260809140100`) joins `v_ad_name_resolution`, but that view was created at `20260809140200` — later in the sequence. The live database is fine, because the objects were applied in dependency order by hand, but replaying this directory from scratch into a fresh environment would fail on `20260809140100` with "relation v_ad_name_resolution does not exist".

Rename the file so the sequence matches the dependency:

```bash
git mv supabase/migrations/20260809140200_v_ad_name_resolution.sql \
       supabase/migrations/20260809140050_v_ad_name_resolution.sql
```

Change no SQL inside it and do not re-apply it — this is a local filename fix only. Confirm the resulting order is: `140000` helpers, `140050` name resolution, `140100` sessions, `140300` payments.

**Interfaces:**
- Consumes: every `public.metric_*` function from Tasks 2 and 3; `public.ads`; `public.v_ad_name_resolution` (the shared campaign-scoped unique-ad-name rule, extracted during Task 4 — join it, never re-inline the CTE, or the two views can drift apart on the rule that decides whether a name is safe to trust); `public.clients` (for one derived boolean only).
- Produces: view `public.v_payments_attributed` — all `payments` columns plus `utm_source_clean text`, `ad_key text`, `ad_key_type text`, `adset_key text`, `campaign_key text`, `attribution_tier text`, `ad_name text`, `adset_name text`, `campaign_name text`, `is_paid boolean`, `is_test_payment boolean`, `is_test_client boolean`, `day_ist date`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809140300_v_payments_attributed.sql`:

```sql
-- Three-tier attributed read layer over payments. Mirrors
-- v_sessions_attributed exactly, except the raw source is the utm_params jsonb
-- rather than a URL query string, and the test-row marking is added.
--
-- THE clients JOIN EXISTS ONLY to derive is_test_client. It must stay a
-- projection of that single boolean: `select c.*` here would expose
-- razorpay_key_secret_enc / razorpay_webhook_secret_enc / tagmango_*_enc, which
-- are AES-256-GCM ciphertext this dashboard must never read. LEFT join, so a
-- payment can never vanish because its client row is invisible.
--
-- starts_with() rather than LIKE 'rzp\_test%', so the underscore cannot be
-- misread as a single-character wildcard.
--
-- is_paid is `status = 'paid' OR paid_at IS NOT NULL` because a few rows are
-- paid with a null paid_at. day_ist prefers paid_at so revenue buckets on the
-- day the money actually arrived.
--
-- is_test_payment is a PAYMENT-level rule, not a product-level one: test
-- products get repriced to their real value after roughly five transactions, so
-- a product flag would retroactively misclassify that product's whole history.
-- payments.amount is sourced server-side at payment time, so those rows keep
-- the Rs 1 value permanently. Test rows stay visible and stay in totals -- they
-- are badged, never filtered.
create or replace view public.v_payments_attributed
with (security_invoker = true) as
with resolved as (
  select
    p.*,
    coalesce(p.ad_id, public.metric_ad_id_from_params(p.utm_params)) as ad_id_resolved,
    coalesce(p.adset_id, public.metric_adset_id_from_params(p.utm_params)) as adset_id_resolved,
    coalesce(p.campaign_id, public.metric_campaign_id_from_params(p.utm_params)) as campaign_id_resolved,
    public.metric_normalize_key(p.utm_params ->> 'utm_content') as ad_name_raw
  from public.payments p
),
keyed as (
  select
    r.*,
    nic.meta_ad_id as ad_id_from_name
  from resolved r
  left join public.v_ad_name_resolution nic
    on r.ad_id_resolved is null
   and nic.client_id = r.client_id
   and nic.meta_campaign_id = r.campaign_id_resolved
   and nic.ad_name = r.ad_name_raw
)
select
  k.id, k.client_id, k.session_id, k.product_id,
  k.order_id, k.payment_id, k.gateway, k.status,
  k.amount, k.currency,
  k.customer_name, k.customer_email, k.customer_phone,
  k.utm_source, k.utm_medium, k.utm_campaign, k.fbclid, k.gclid,
  k.utm_params, k.customer_data, k.raw_payload,
  k.campaign_id, k.adset_id, k.ad_id,
  k.visit_count, k.minutes_to_convert,
  k.created_at, k.paid_at,
  public.metric_clean_utm_source(k.utm_source) as utm_source_clean,
  coalesce(k.ad_id_resolved, k.ad_id_from_name) as ad_key,
  case
    when k.ad_id_resolved is not null then 'ad_id'
    when k.ad_id_from_name is not null then 'ad_name'
    else 'none'
  end as ad_key_type,
  coalesce(k.adset_id_resolved, a.meta_adset_id) as adset_key,
  coalesce(k.campaign_id_resolved, a.meta_campaign_id) as campaign_key,
  case
    when coalesce(k.ad_id_resolved, k.ad_id_from_name) is not null then 'ad'
    when coalesce(k.adset_id_resolved, a.meta_adset_id) is not null then 'adset'
    when coalesce(k.campaign_id_resolved, a.meta_campaign_id) is not null then 'campaign'
    else 'none'
  end as attribution_tier,
  a.ad_name,
  a.adset_name,
  a.campaign_name,
  (k.status = 'paid' or k.paid_at is not null) as is_paid,
  (k.amount <= 500) as is_test_payment,
  coalesce(starts_with(c.razorpay_key_id, 'rzp_test'), false) as is_test_client,
  (coalesce(k.paid_at, k.created_at) at time zone 'Asia/Kolkata')::date as day_ist
from keyed k
left join public.ads a
  on a.meta_ad_id = coalesce(k.ad_id_resolved, k.ad_id_from_name)
 and a.client_id = k.client_id
left join public.clients c on c.id = k.client_id;

grant select on public.v_payments_attributed to anon, authenticated;
```

Verify the base column list against `information_schema` exactly as in Task 4 before applying.

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
  it("marks a payment at or below 500 paise as a test payment", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from(VIEW).select("amount, is_test_payment").limit(1000);
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
    const { data, error } = await admin.from(VIEW).select("status, paid_at, is_paid").limit(1000);
    if (error) throw new Error(error.message);
    for (const row of data!) {
      expect(row.is_paid).toBe(row.status === "paid" || row.paid_at !== null);
    }
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

  it("assigns the most specific tier that resolved", async () => {
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("ad_key, adset_key, campaign_key, attribution_tier")
      .limit(1000);
    if (error) throw new Error(error.message);
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

  it("leaves payments with no session unattributed at every tier", async () => {
    // 16 payments have no session_id and are permanently unattributable.
    const admin = await adminClient();
    const { data, error } = await admin
      .from(VIEW)
      .select("session_id, attribution_tier")
      .is("session_id", null);
    if (error) throw new Error(error.message);
    expect(data!.length).toBeGreaterThan(0);
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/v-payments-attributed.test.ts`
Expected: FAIL — the relation does not exist.

- [ ] **Step 4: Apply the migration**

`mcp__claude_ai_Supabase__apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `v_payments_attributed`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/v-payments-attributed.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add supabase/migrations/20260809140050_v_ad_name_resolution.sql supabase/migrations/20260809140300_v_payments_attributed.sql tests/v-payments-attributed.test.ts
git commit -m "feat(db): add v_payments_attributed with three-tier attribution"
```

---

### Task 6: `v_funnel_by_session`

Unchanged in substance by the revision — the funnel does not touch attribution. Renumbered only.

**Files:**
- Create: `supabase/migrations/20260809140400_v_funnel_by_session.sql`
- Create: `tests/v-funnel-by-session.test.ts`

**Interfaces:**
- Produces: view `public.v_funnel_by_session` — `session_id uuid`, `client_id uuid`, `product_id uuid`, `day_ist date`, and six booleans `reached_page_load`, `reached_form_open`, `reached_form_start`, `reached_form_submit`, `reached_payment_open`, `reached_payment_complete`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260809140400_v_funnel_by_session.sql`:

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

`mcp__claude_ai_Supabase__apply_migration`, `project_id` `ggfkbcdegkpqrjmqjfyw`, `name` `v_funnel_by_session`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/v-funnel-by-session.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add supabase/migrations/20260809140400_v_funnel_by_session.sql tests/v-funnel-by-session.test.ts
git commit -m "feat(db): add v_funnel_by_session with reached-or-beyond semantics"
```

---

### Task 7: Named metrics and the Unattributed bucket across three tiers

Pure TypeScript, unit-tested in isolation with no database access. The only place the two metric names and the Unattributed label are defined.

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
  - `type AttributionTier = "ad" | "adset" | "campaign"`
  - `type AttributedGroup = { key: string | null; label: string; value: number; isUnattributed: boolean }`
  - `groupWithUnattributed<T>(rows: T[], keyOf: (row: T) => string | null | undefined, valueOf: (row: T) => number): AttributedGroup[]`
  - `tierKeyOf<T extends TierKeys>(tier: AttributionTier): (row: T) => string | null`
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
    expect(conversionRate(467, 8238)).toBeCloseTo(0.0567, 4);
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
    expect(checkoutCompletion(467, 716)).toBeCloseTo(0.6522, 4);
  });

  it("differs from conversionRate on the same paid count", () => {
    expect(checkoutCompletion(467, 716)).not.toBe(conversionRate(467, 8238));
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
  tierKeyOf,
} from "@/lib/metrics/attribution";

type Row = {
  ad_key: string | null;
  adset_key: string | null;
  campaign_key: string | null;
  revenue: number;
};

const row = (
  ad: string | null,
  adset: string | null,
  campaign: string | null,
  revenue: number
): Row => ({ ad_key: ad, adset_key: adset, campaign_key: campaign, revenue });

// Two rows on one ad, one row resolving only an ad set, one only a campaign,
// and one resolving nothing at all.
const rows: Row[] = [
  row("120242114093820519", "120237239322730519", "120235128175530519", 9900),
  row("120242114093820519", "120237239322730519", "120235128175530519", 9900),
  row(null, "120237239322730519", "120235128175530519", 4900),
  row(null, null, "120235128175530519", 9900),
  row(null, null, null, 100),
];

const byRevenue = (r: Row) => r.revenue;
const total = rows.reduce((sum, r) => sum + r.revenue, 0);

describe("groupWithUnattributed (AC-5, AC-20)", () => {
  it("reconciles at every tier: grouped rows plus Unattributed equal the total", () => {
    for (const tier of ["ad", "adset", "campaign"] as const) {
      const groups = groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue);
      expect(groups.reduce((sum, g) => sum + g.value, 0), `tier ${tier}`).toBe(total);
    }
  });

  it("emits exactly one explicit Unattributed row at every tier", () => {
    for (const tier of ["ad", "adset", "campaign"] as const) {
      const groups = groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue);
      const unattributed = groups.filter((g) => g.isUnattributed);
      expect(unattributed, `tier ${tier}`).toHaveLength(1);
      expect(unattributed[0].label).toBe(UNATTRIBUTED_LABEL);
      expect(unattributed[0].key).toBeNull();
    }
  });

  it("counts an ad-set-only row as attributed at ad set level and Unattributed at ad level", () => {
    const adGroups = groupWithUnattributed(rows, tierKeyOf<Row>("ad"), byRevenue);
    const adsetGroups = groupWithUnattributed(rows, tierKeyOf<Row>("adset"), byRevenue);

    // 4900 (ad-set-only) + 9900 (campaign-only) + 100 (nothing) at ad level
    expect(adGroups.find((g) => g.isUnattributed)?.value).toBe(14900);
    // at ad set level the 4900 joins the real ad set group
    expect(adsetGroups.find((g) => g.key === "120237239322730519")?.value).toBe(24700);
    expect(adsetGroups.find((g) => g.isUnattributed)?.value).toBe(10000);
  });

  it("narrows the Unattributed bucket as the tier gets less specific", () => {
    const values = (["ad", "adset", "campaign"] as const).map(
      (tier) =>
        groupWithUnattributed(rows, tierKeyOf<Row>(tier), byRevenue).find((g) => g.isUnattributed)!
          .value
    );
    expect(values[0]).toBeGreaterThan(values[1]);
    expect(values[1]).toBeGreaterThan(values[2]);
    expect(values[2]).toBe(100);
  });

  it("sums rows sharing a key", () => {
    const groups = groupWithUnattributed(rows, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups.find((g) => g.key === "120242114093820519")?.value).toBe(19800);
  });

  it("still emits an Unattributed row when nothing is unattributed, so totals line up", () => {
    const allAttributed = [row("120111222333", "120444555666", "120777888999", 100)];
    const groups = groupWithUnattributed(allAttributed, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups.filter((g) => g.isUnattributed)).toHaveLength(1);
    expect(groups.find((g) => g.isUnattributed)?.value).toBe(0);
  });

  it("treats empty and whitespace-only keys as unattributed", () => {
    const messy = [row("", null, null, 10), row("   ", null, null, 20), row(null, null, null, 30)];
    const groups = groupWithUnattributed(messy, tierKeyOf<Row>("ad"), byRevenue);
    expect(groups).toHaveLength(1);
    expect(groups[0].isUnattributed).toBe(true);
    expect(groups[0].value).toBe(60);
  });

  it("sorts attributed groups by descending value, keeping Unattributed last", () => {
    const groups = groupWithUnattributed(rows, tierKeyOf<Row>("campaign"), byRevenue);
    expect(groups[groups.length - 1].isUnattributed).toBe(true);
    const attributed = groups.filter((g) => !g.isUnattributed);
    for (let i = 1; i < attributed.length; i++) {
      expect(attributed[i - 1].value).toBeGreaterThanOrEqual(attributed[i].value);
    }
  });

  it("returns only the zero Unattributed row for empty input", () => {
    const groups = groupWithUnattributed([] as Row[], tierKeyOf<Row>("ad"), byRevenue);
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
 * Grouping helpers that guarantee a breakdown reconciles to its real total.
 *
 * Rows resolving no key at the requested tier are collected into one explicit
 * Unattributed group rather than filtered out, and that group is emitted even
 * when empty, so every breakdown satisfies:
 *   grouped rows + Unattributed = ungrouped total.
 *
 * Attribution runs in three tiers. A row that resolved an ad set but no ad is
 * attributed at ad set level and Unattributed at ad level — both are true at
 * once, and both must hold. Selecting the tier through tierKeyOf keeps that
 * property in one place instead of scattered across call sites.
 */
export const UNATTRIBUTED_LABEL = "Unattributed";

export type AttributionTier = "ad" | "adset" | "campaign";

export type TierKeys = {
  ad_key?: string | null;
  adset_key?: string | null;
  campaign_key?: string | null;
};

export type AttributedGroup = {
  key: string | null;
  label: string;
  value: number;
  isUnattributed: boolean;
};

const TIER_COLUMN: Record<AttributionTier, keyof TierKeys> = {
  ad: "ad_key",
  adset: "adset_key",
  campaign: "campaign_key",
};

/** Key accessor for one attribution tier, for passing to groupWithUnattributed. */
export function tierKeyOf<T extends TierKeys>(
  tier: AttributionTier
): (row: T) => string | null {
  const column = TIER_COLUMN[tier];
  return (row) => row[column] ?? null;
}

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
git commit -m "feat: add named metrics and three-tier Unattributed grouping"
```

---

## Acceptance criteria coverage

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | `utm_source=` prefix aggregates under the clean label | Task 2 (`metric_clean_utm_source`), Tasks 4 & 5 (`utm_source_clean`) |
| AC-2 | Payments ≤ 500 paise and `rzp_test` clients marked, still visible | Task 5 (`is_test_payment`, `is_test_client`) |
| AC-3 | Two separately named metrics, neither called "conversion" | Task 7 (`definitions.ts`) |
| AC-4 | Canonical ad key with identifier-vs-name match type | Tasks 2 & 3 (extraction), Tasks 4 & 5 (`ad_key`, `ad_key_type`) |
| AC-5 | Unattributed bucket, never silently dropped | Task 7 (`groupWithUnattributed`) |
| AC-6 | Every view returns only the caller's rows unless admin | Tasks 4, 5, 6 (`security_invoker` + RLS test pairs) |
| AC-20 | Rows resolving a coarser tier counted there, Unattributed at the finer tier | Tasks 4 & 5 (`adset_key`, `campaign_key`, `attribution_tier`), Task 7 (`tierKeyOf`) |

## Out of scope for this slice

- Seeding Occultyogis Vastu into `ads`. Blocked on an Ads Manager export from Sharan — `temp-folder/meta_ad_hierarchy_mapping.csv` holds Love School's 67 ads only. Until it lands, Occultyogis resolves ad keys by extraction but shows no ad, ad set or campaign names. The views handle this by design and Task 4 tests it explicitly.
- Spend, ROAS and CPA. There is still no cost data in the schema; that is Slice B.
- Any UI. The Ads section is Slice D.
- Fixing the `utm_source=` capture bug at source, which lives in the Trace repo.
- Backfilling `campaign_id` / `adset_id` / `ad_id` for clients other than Love School. The views bridge with extraction, so a backfill is an optimisation, not a correctness requirement.

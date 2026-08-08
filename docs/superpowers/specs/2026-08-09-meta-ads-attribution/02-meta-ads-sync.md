# 02. Meta Ads Sync: tables, API client and scheduled job

Child of [index.md](index.md). Depends on [01-metrics-foundation.md](01-metrics-foundation.md) for the join key.

## Summary

This brings Meta ad spend and creative images into the database. It adds four tables, a small hand written client for Meta's API, and a nightly job on Vercel Cron that pulls one row per ad per day. Creative images are copied into Supabase Storage so they render for everyone and never expire.

Access uses Partner sharing: each client grants your Business Manager the view performance task on their ad account, and one agency System User token reads them all. That is the smallest permission you can ask for, and it avoids Meta's App Review entirely.

## Requirements

Satisfies **AC-7** to **AC-15** from [index.md](index.md).

## Design

### Tables

Full column list in [index.md](index.md). Four tables: `ad_accounts`, `ads`, `ad_insights_daily`, `sync_runs`. Every one carries `client_id` so row level security is a direct column check with no join.

Row level security reads copy `supabase/migrations/20260707000000_dashboard_rls_policies.sql`: `client_id` matching the JWT claim, OR the `is_admin` claim. Unlike Trace's read only tables, these four also need deliberate write policies: `WITH CHECK` on insert and update permitting rows only when the JWT carries `is_admin`. A `USING` only policy denies writes outright in Postgres, and the service role key inside a request handler is forbidden by `.claude/rules/auth-security.md`, so the sync authenticates as the existing admin identity and writes under these policies.

The unique constraint on `ad_insights_daily(ad_id, date_start)` is what makes the sync idempotent. Every write is an upsert on that key.

### Meta API client

A thin typed wrapper in `src/lib/meta/`, no SDK. Endpoints used:

| Purpose | Endpoint |
|---|---|
| List ad accounts the System User can see | `/{business_id}/owned_ad_accounts` and `/{business_id}/client_ad_accounts` |
| Ad metadata | `/{ad_account_id}/ads` with `fields=id,name,adset{id,name},campaign{id,name},status,creative{id,thumbnail_url,image_url}`, filtered to include paused and archived ads, so historical name matches keep resolving after an ad is retired |
| Daily spend | `/{ad_account_id}/insights` with `level=ad`, `time_increment=1`, `fields=spend,impressions,clicks,reach` |
| Long ranges | The same insights call with `async=true`, then poll the report run |

Rules the client must follow:

- Target the version in `META_API_VERSION`, never latest. Meta sunsets versions on a schedule; moving is a deliberate act.
- Read `X-Business-Use-Case-Usage` on every response. Above 80% usage, slow down. On error code 17, back off exponentially and retry.
- Use `async=true` for the backfill. Synchronous insight calls over long ranges time out, and Vercel functions have their own limit.
- Paginate through `paging.next` until exhausted. Never assume one page.

### Sync behaviour

**Two step execution.** A Meta asynchronous report can run for minutes, longer than one function invocation, so no invocation ever waits on Meta. Step one submits the report, writes a `sync_runs` row in `running` state carrying `meta_report_id`, and returns. Step two, on the next cron tick or manual trigger, finds `running` rows, checks each report's status, ingests completed ones, and closes the row as `success` or `failed`. A `running` row older than a defined cutoff (recommend 3 hours, mirroring Airbyte's judgement for the same job) is closed as `failed` and resubmitted.

| Concern | Rule |
|---|---|
| Backfill | From 2026-06-27, the first session date, via asynchronous jobs, one `sync_runs` row per month chunk |
| Backfill completion | An account is backfilled when every month chunk back to 2026-06-27 has a `success` row. The next run picks the earliest missing chunk, so a crashed backfill resumes rather than restarts, and a month with zero spend still has its `success` row and is not re fetched |
| Nightly window | Rolling last 7 days, re synced every run. Meta restates spend for roughly 3 days, so 7 is comfortable margin |
| Idempotency | Upsert on `(ad_id, date_start)`. Re running any window is always safe |
| Day boundary | Request insights in the ad account's own timezone, then store `date_start` as the Asia/Kolkata date so it buckets identically to payment data |
| Currency | Meta returns a decimal string in the account currency. Convert to integer minor units and store `currency` alongside. Never store as float |
| Deleted ads | An ad absent from Meta keeps its rows and gets `status = 'inactive'`. Historical figures never change retroactively |
| Creatives | Download `thumbnail_url`, upload to a private Supabase Storage bucket, store the path. Served only through short lived signed URLs minted server side, so tenant separation matches the tables. Do not store Meta preview iframes: they expire after 24 hours and may not render for viewers without a role on the ad account |
| Every run | Writes a `sync_runs` row: `running` first (with `meta_report_id` when async), then `success`, `partial` or `failed` with counts and any error. `kind` is one of `backfill`, `nightly`, `manual` |

### Trigger surface

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/api/ads/sync` | POST | `CRON_SECRET` header, or admin session | Returns 409 if a run is already in progress for that account |
| `/api/ads/accounts` | GET | admin | Lists accounts the System User can see, plus current mappings |
| `/api/ads/accounts` | POST | admin | Maps a Meta account to a Trace client. Rejects with 422 and a clear message when the account currency is not INR, so ROAS can never divide mismatched units. Lifting this later is a deliberate feature |
| `/api/ads/accounts/:id` | DELETE | admin | Sets `disconnected`, retains history |

Vercel Cron calls the sync endpoint nightly. The manual refresh button in the Ads section calls the same endpoint as an admin.

### Credential handling

The System User token lives in Supabase Vault, read server side at sync time only. It is never selected into any table reachable through PostgREST, never returned by an endpoint, and never sent to the browser. Prerequisite before any code: create the System User in Business Settings and have each client grant it the view performance task on their ad account.

The schema deliberately leaves room for a nullable per account token reference, so a per client OAuth path could be added later without restructuring.

## Build plan

1. Migration creating the four tables plus row level security policies, satisfies **AC-7**.
2. Meta client with version pinning, pagination, rate limit handling and backoff, satisfies **AC-15**.
3. System User token into Supabase Vault, read server side only, satisfies **AC-14**.
4. Admin mapping screen and the three account endpoints, satisfies **AC-7**.
5. Sync one account for one day end to end, writing all three data tables, satisfies **AC-8**, **AC-10**, **AC-13**.
6. Backfill from 2026-06-27 using asynchronous jobs, satisfies **AC-9**.
7. Vercel Cron nightly run with the rolling 7 day window, satisfies **AC-9**, **AC-13**.
8. Asia/Kolkata day bucketing, satisfies **AC-8**.
9. Creative mirroring into Supabase Storage, satisfies **AC-11**.
10. Mark absent ads inactive while retaining history, satisfies **AC-12**.

## Rationale

A hand written client rather than the official SDK, because this needs four read only endpoints and absolute control of the API version. Airbyte and Fivetran both call the Graph API directly and both deliberately pin older versions than current, which is the same requirement here. Meta recommends its SDK, and that recommendation makes sense for an integration spanning many of their APIs, which this is not.

Partner access rather than per client OAuth, because `ads_read` with the Analyst role is sufficient for reporting, and because reaching accounts owned by other businesses needs Advanced access, which must be maintained with at least 500 API calls every 15 days. A four client nightly sync may fall below that floor and lose access for being too small.

Mirrored thumbnails rather than live preview iframes, because the iframes expire after 24 hours and Meta's documentation indicates account level previews are only visible to people holding a role on the ad account, which client users will not have.

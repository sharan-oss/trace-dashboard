---
globs: ["src/**"]
---

# Trace's Data Model (source of truth — read before writing any query)

Five core Postgres tables plus the dashboard-owned `ads` dimension, all with
Row Level Security enabled. RLS policies (added in
`supabase/migrations/20260707000000_dashboard_rls_policies.sql`, `ads` in
`20260809130000_ads_dimension_table.sql`) scope every read; app-layer
filtering is a nice-to-have on top, never the only defense.

### `clients` — tenant/business
`id, name, api_key, domains[], gateway ('razorpay'|'tagmango'), razorpay_key_id, razorpay_key_secret_enc, razorpay_webhook_secret_enc, tagmango_api_key_enc, tagmango_webhook_secret_enc, created_at`

### `products` — catalog item per client
`id, client_id, slug, name, description, amount (smallest currency unit, e.g. paise), currency, gateway, thankyou_path, pabbly_webhook, created_at`. Unique on `(client_id, slug)`.

### `sessions` — one row per landing page visit
`id, client_id, product_id, fingerprint` (localStorage UUID linking visits from the same device), UTM fields (`utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid`), Meta hierarchy ids (`campaign_id, adset_id, ad_id` — see "Meta hierarchy ids" below), `referrer, landing_url`, device fields (`device_ram_gb, device_cpu_cores, device_brand, device_model, device_os, device_os_version`), network fields (`network_type, network_speed_kbps`), perf fields (`fcp_ms, tti_ms`), `created_at`.

### `events` — funnel steps
`id, session_id, client_id, product_id, event_type, created_at`. `event_type` is an **ordered** funnel: `page_load → form_open → form_start → form_submit → payment_open → payment_complete`. Always treat this as an ordered sequence when building funnel/drop-off views, not an unordered category.

### `payments`
`id, client_id, session_id, product_id, order_id (unique), payment_id (unique), gateway, status ('created'|'paid'|'failed'), amount, currency, customer_name, customer_email, customer_phone`, dedicated UTM columns (`utm_source, utm_medium, utm_campaign, fbclid, gclid`) plus `utm_params jsonb` (catch-all for extra params), `customer_data jsonb` (extra form fields beyond name/email/phone), `raw_payload jsonb` (full gateway webhook payload), `visit_count` (count of sessions by this fingerprint for this client+product, computed at payment time), `minutes_to_convert` (time from session start to payment), `created_at, paid_at`.

- `payments` also carries the Meta hierarchy ids `campaign_id, adset_id, ad_id` (see below).
- `utm_params` can include `fbc_id`/`h_ad_id` — these are Meta ad-set/ad IDs, NOT the same as `fbclid`, which is Meta's click ID. Don't conflate the two when building attribution views.
- `raw_payload` can legitimately be `{}` even for a successfully paid transaction, if the webhook wasn't registered for that client (see `.claude/rules/invariants.md` for why). Use `paid_at` as the reliable "did this actually get paid" signal, not `raw_payload` presence.

### `ads` — dashboard-owned Meta ad dimension (added 2026-08-09)
`id, client_id, ad_account_id (nullable until Slice B), meta_ad_id (unique), meta_adset_id, meta_campaign_id, ad_name, adset_name, campaign_name, status, creative_thumbnail_path, creative_source_url, first_seen_at, last_synced_at`. One row per Meta ad with its full campaign → adset → ad hierarchy. Seeded manually for Love School (67 ads) from an Ads Manager export; the Slice B nightly sync later upserts on `meta_ad_id`. Unlike the five core tables this one is dashboard-owned and admin-writable (`WITH CHECK is_admin`).

### Meta hierarchy ids on `sessions` and `payments` (added 2026-08-09)
Additive nullable text columns `campaign_id, adset_id, ad_id`, values mirroring `ads.meta_*`. Love School's history was backfilled once (ids extracted exactly; ad names resolved only when unique within the row's campaign; hierarchy completed from `ads`; originals untouched byte-for-byte). Null means unresolved OR the row arrived after the backfill — new rows stay null until Trace's capture writes them, so attribution reads `coalesce(stored, extracted)`.

### Proven raw-slot semantics (verified against Meta's own hierarchy export)
- `utm_id` / `campaign_id` param = Meta campaign id.
- `utm_term` = the adset **id** when numeric, the adset **name** otherwise (two template eras — always apply the numeric guard).
- `h_ad_id` ≡ `Ad_id` / `Ad ID` variants = Meta ad id (duplicates of each other).
- `utm_content` = ad **name**, and ad names are NOT unique (reused across ads, even within one campaign) — never match names unscoped.

See `.claude/rules/invariants.md` for hard rules and `.claude/rules/auth-security.md` for how these tables are scoped by tenant.

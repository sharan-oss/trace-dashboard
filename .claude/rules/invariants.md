---
globs: ["src/**", "supabase/**"]
---

# Invariants — Never Violate These

- `*_secret_enc` columns (`razorpay_webhook_secret_enc`, `razorpay_key_secret_enc`, `tagmango_*_enc`) are AES-256-GCM **ciphertext**. Never query, decrypt, log, or display them in this dashboard. There is no legitimate reason for the dashboard to ever touch these columns.
- `payments.amount` is trustworthy as-is — Trace's backend always sources amount server-side from `products.amount`, never from client input, so you don't need to re-validate it here.
- Webhooks always return HTTP 200 in Trace regardless of internal success/failure (deliberate design so Razorpay/TagMango don't disable delivery). This means `raw_payload = '{}'` does not reliably mean "something's broken" — check `paid_at` instead when building any "is this data healthy" diagnostic.
- This dashboard connects to Trace's Supabase project using a **publishable key + RLS**, never the secret/service-role key. The secret key and any encryption master key belong to Trace's own env only and must never appear in this repo's `.env` files, code, or committed `.claude/` settings.
- Don't build any TagMango-specific view — TagMango gateway is still stubbed on Trace's side, there's no real data to show yet.
- Don't build a read API layer on Trace itself — this was explicitly decided against; the dashboard connects directly to Supabase.
- Don't lock in specific chart libraries, color palettes, or detailed visual design from planning docs — bring those choices to Sharan directly, informed by browsing current examples first (see `.claude/rules/workflow.md`).
- Never rely on application-layer `WHERE client_id = ...` filtering as your only defense — a bug in a query is then a tenant data leak. RLS at the database level is the actual guarantee.

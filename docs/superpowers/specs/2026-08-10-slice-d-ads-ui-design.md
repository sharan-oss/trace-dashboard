# Slice D — Ads UI + Overview unlock

Approved by Sharan 2026-08-10 (chat). Child of
`docs/superpowers/specs/2026-08-09-meta-ads-attribution/03-ads-ui.md`; this
document records the decisions made at build time and the deltas against that
spec. Where they disagree, this document wins.

## Scope decisions (Sharan, 2026-08-10)
- **Overview unlock included**: the Spend/CPA tiles and Spends/CPA chart tabs
  go live in this slice — the "Connect Meta" locks disappear.
- **Account-mapping UI deferred**: accounts are mapped via the existing API
  routes; the empty state explains rather than links. Post-Phase 2 self-serve
  Connect replaces it.
- **Ratio metrics**: ROAS = (L1+L2) revenue ÷ Meta spend, labelled
  "ROAS (L1+L2)" — full customer value credited to the acquiring ad, matching
  the L2 acquisition-credit rule. CPA = spend ÷ L1 paid count, labelled
  "CPA (L1)". Revenue columns always show L1 and L2 separately. Spend is
  always labelled "Meta spend".

## Deltas against 03-ads-ui.md
- Visual system is **v2 dark** (2026-08-10), not the 2026-08-08 light spec it
  references. Dark glass, alpha elevation, indigo-only accent.
- `sync_runs` → `ad_sync_runs`.
- The categorical >2-series palette decision **stays deferred**: the Ads page
  ships no multi-series chart, and each Overview tab holds ≤2 series.
- The Occultyogis onboarding-date note is moot until Occultyogis has a mapped
  account; generalised to nothing for now.
- Revenue everywhere is the L1/L2 pair, not a single "revenue" figure.

## Data layer — three new RPCs (pattern: overview_aggregate_rpcs)
All `security invoker`, `set search_path = public`, `p_days` null = all time,
IST windows, execute revoked from anon/public and granted to authenticated.
Attribution only ever read off the views, never re-derived.

1. **`ads_breakdown(p_client_id, p_days)`** — one call, all three tiers via
   `GROUP BY GROUPING SETS ((campaign), (campaign,adset), (campaign,adset,ad))`
   over four separately-aggregated fact CTEs full-joined on
   (tier, sentinel-coalesced keys): Meta spend (ad_insights_daily × ads),
   L1 revenue+count (v_payments_attributed, is_paid), L2 revenue+count
   (external_payments via customers.l1_payment_id acquisition credit —
   copied from overview_top_ads), sessions (v_sessions_attributed).
   Row fields include names (dimension first, view fallback), ad thumbnail
   path + status, `name_matched` (bool_or(ad_key_type='ad_name')), `has_test`
   (bool_or(is_test_payment or is_test_client)), and campaign-tier-only
   revenue on campaign rows. Null-key groups ARE returned — they are the
   Unattributed buckets the UI renders per level.
2. **`ads_summary(p_client_id, p_days)`** — spend_paise,
   spend_untracked_paise (spend on ads whose meta_ad_id matches no in-range
   session ad_key), unattributed_l1_revenue_paise + count (ad_key null OR not
   in this client's ads). Tiles combine this with the existing
   `overview_kpis` for L1/L2/sessions — no duplicated definitions.
3. **`overview_spend_daily(p_client_id, p_days)`** — day, spend_paise,
   l1_paid_count (daily CPA is a display division client-side).

## UI
- **/ads** (replaces stub): per-account sync-status line (stale / "sync in
  progress", keyed on newest ad_sync_runs with finished_at, running rows
  distinct); six KpiTiles (Meta spend · L1 revenue · L2 revenue ·
  ROAS (L1+L2) · CPA (L1) · Conversion rate); the campaign → ad set → ad
  drill-down as ONE client-component table (expand state only), ad rows with
  signed-URL thumbnails (1h, minted server-side from the private bucket);
  reconciliation rows always present, even at zero ("Spend, no tracked
  sessions" — revenue n/a; "Unattributed revenue" — spend n/a); name-match
  marker + Test badge (existing StatusBadge); n/a never rendered as zero or
  bare dash; ROAS never colour-coded. Five distinct states: empty (no
  account mapped), loading (loading.tsx skeleton), error, sync-in-progress,
  synced-but-zero-spend-in-range.
- **Overview**: Spend + CPA tiles unlocked (real values, "Meta spend" /
  "CPA (L1)" labels); revenue-chart-card gains working tab state —
  Revenue (L1+L2 series, unchanged) | Spends (single spend series) |
  CPA (single derived series). Locked-tab affordance removed.
- **`src/lib/metrics/definitions.ts`** gains `roas()` and `cpa()` with the
  file's null-on-zero-denominator discipline and exported labels.

## Verification
RPC tests follow tests/overview-rpcs.test.ts doctrine: SDK-oracle
reconciliation (paged, never capped), invariants not absolute counts (e.g.
campaign-tier spend total = summary spend = paged oracle sum; attributed +
unattributed L1 = overview_kpis L1), tenant scoping (other-client zeros, anon
execute refused), null-bucket presence. UI verified in the real browser at
desktop + mobile widths with zero console errors before merge.

# Memory — Ads Manager deep links + ad preview click-through

Last updated: 2026-09-07

## What was built

Two shipped pieces this session, both on top of the day drill-down (commit `f53f208`).

**1. Ads Manager deep links actually resolve.** Two silent bugs in one link:
- `src/lib/meta/ads-manager.ts` — `adsManagerUrl` takes a third arg and emits `selected_campaign_ids` **before** `selected_ad_ids`. Without the campaign, Ads Manager resolves the ad against the account's *unfiltered* list and the viewer lands in all ~1,200 ads.
- Same file — new `makeAdAccountResolver(accounts)` maps `ads.ad_account_id` → `ad_accounts.meta_ad_account_id` per ad. Replaces a hardcoded `accounts[0]` in `src/app/(dashboard)/ads/page.tsx`.
- Threaded through `src/lib/queries/ads.ts` (added `ad_account_id` to `AdDimensionRow` + its select), `src/components/ads/ad-card.tsx` (`adAccountId` on `AdCardData`; prop is now a `metaAdAccountFor` resolver), `src/components/ads/ad-cards.tsx`.
- `tests/ads-manager.test.ts` 2 → 11 cases.

**2. Ad creative previews click through to Ads Manager.**
- `src/lib/creatives.ts` — `AdCreativeMeta` gained `adsManagerUrl`, built by embedding `ad_accounts(meta_ad_account_id)` + `meta_campaign_id` in the existing keyed `ads` read. New `embeddedAccount()` normalises the embed shape.
- `src/components/customers/ad-peek.tsx` — popup body extracted to `PeekBody`; wrapped in an `<a>` with an "Open in Ads Manager" line when a URL exists.
- `tests/creatives-ads-manager-link.test.ts` (new, 4 cases, live reads).
- Applies to all five AdPeek surfaces (Customers' People table, customer sheet, acquisition table, top-customers strip, and Funnel segments) — Sharan chose consistency over Customers-only.

## Decisions made

- **The account must be the ad's own, never a default.** `makeAdAccountResolver` answers for an unknown ad only when the client has exactly one account; with several it returns null and the link is **hidden**. Picking a default *is* the bug being removed, so it must not survive as a fallback.
- **The link lives in the AdPeek popup, not on the ad-name trigger.** The popup is portaled, so an `<a>` there can never nest inside the row `<Link>`s some call sites wrap, and the trigger's behaviour is untouched.
- **A PreviewCard may host an action; a tooltip may not.** PreviewCard is built to be entered and stays open while hovered. A tooltip sets `pointer-events: none` precisely so it cannot be — see the comment in `revenue-chart-card.tsx`.
- **Meta documents none of these URL params.** Campaign-scoping is Sharan's field-verified behaviour, recorded as such in the code comment. `ads.meta_adset_id` is available if the chain ever needs the middle step.

## Problems solved

- **Love School has TWO live ad accounts** — `act_1052790390047154` (1,155 ads) and `act_1312705356631852` (103). The old `accounts[0]` link named the first for all of them, so those 103 pointed at an account that cannot contain them. Meta answers with an empty selection or its own error — no crash. All 103 are archived/paused, which is why nobody noticed.
- **supabase-js types every embed as an array**; PostgREST returns a bare object for a many-to-one FK. Guessing wrong yields *no link at all*, silently — hence `embeddedAccount()` accepts both and the test reads live rather than mocking.
- **`ad_accounts` read policy is `is_admin OR client_id`**, so client users get the link too. Asserted in a test, because this is a feature for their clients.
- **The live suite flakes under repeated runs** — a back-to-back run gave 54 spurious failures, all `AuthRetryableFetchError: fetch failed` on sign-in. Re-run before believing any mass failure.
- **Never run `npm run build` while `next dev` is live.** Both write to `.next/`; doing so during this session may have made the dev server serve stale chunks and muddied UI debugging.

## Current state

Typecheck clean. Suite **383 passed / 1 failed**. The one failure is pre-existing and unrelated: `tests/v-sessions-attributed.test.ts:175` — live sessions since 2026-09-03 carry `sessions.ad_id` of `"1202"` or `""`; the `^[0-9]{6,}$` guard correctly rejects them so the row name-matches, but the test asserts the *raw* `ad_id` is null.

Not verified: the visual pass, and whether a campaign-scoped link truly lands on the campaign in Ads Manager — that needs a Meta role on the account, so it is Sharan's click.

## Next session starts with

**Open bug: AdPeek's hover preview does not appear inside the customer detail sheet.** It works everywhere else. Pre-existing — the click-through work never touched the trigger, the portal or the Dialog.

Two hypotheses were tried and **both reverted, do not repeat**:
1. z-index — popup raised to `z-60` (everything floating here is `z-50`, including the sheet's `Dialog.Popup`). No effect.
2. modal pointer-blocking — `modal="trap-focus"` on the sheet, which drops base-ui's viewport-covering `InternalBackdrop` (mounted only when `modal === true`, `DialogPortal.js:43`) and re-enables outside pointer interaction. No effect.

**Start where I should have:** does the popup element exist in the DOM at all? Hover the ad name in the sheet with devtools open and inspect the end of `<body>`. No element → the open logic isn't firing inside the dialog. Element present → read its computed `display` / `opacity` / `z-index` / `pointer-events`. That split decides it; neither guess above addressed it.

Begin from `rm -rf .next && npm run dev` — the dev server was polluted by concurrent builds this session.

## Open questions

- `tests/v-sessions-attributed.test.ts:175` — tighten the test to the normalised id, or stop Trace writing truncated `ad_id`s upstream?
- `external_payments.status` has **no CHECK constraint**; `'captured'` is convention-only, so a hand-typed `'paid'` would vanish from every upsell number. Three hand-entered rows in, and the add-transaction UI is still owed.
- `docs/STATUS.md` records customer names, emails and phones for the manual payments. Fine if the private repo is the intended audit trail, but the payment ids alone would preserve it. Still awaiting a call.
- Drill-down on the Spends/CPA chart tabs, gated on promoting the chart tab to a URL param.

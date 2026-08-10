# Landing Page — Copy & Structure (final, approved 2026-08-09)

A premium marketing landing page for Trace, aimed at Indian coaches/course creators who run Meta ads and sell via Razorpay/TagMango. All copy below is final — approved by Sharan section by section. No code exists yet; implementation is a separate round.

References studied for copy style: hyros.com (risk reversal, testimonials-with-numbers), adgraam.com (time-boxed promise, CTA microcopy), datafa.st (category claim, exact-count social proof), marketingexamples.com (specificity, no adjectives, conversational).

## Locked decisions

- **Audience**: Indian coaches & course creators running Meta ads with L1→L2 funnels (low-ticket/webinar → high-ticket program).
- **Angle**: the L2 story. Meta optimizes for cheap CPA; cheap leads often never convert at L2. The winning ad is the one bringing L2 buyers, not the lowest-CPA one.
- **CTA motion**: Request access / waitlist. No free trial, no "no credit card" (1-month minimum engagement).
- **Guarantee policy**: no lock-in, cancel after month one (not a refund promise). Sharan cut the line from the page copy at final review — the policy holds but is currently unstated on the page. If it returns, candidates: final CTA microcopy or footer.
- **Scarcity**: real cap, 4 clients onboarded per month. "Only 4 slots left this month" (final CTA) **must be a live, easily-edited value** Sharan updates as slots fill — never a static fake counter. Fallback if unmaintained: "4 slots a month".
- **Social proof count**: "25+" (round, per Sharan).
- **Proof assets available**: 25+ client faces, real testimonial quotes (to be collected), hard numbers.
- **Usable DB numbers** (live, 2026-08-09): 12,873 visits tracked · 715 payments matched · 9,291 sessions resolved to the exact ad. Do NOT use DB revenue (₹68,629 — weak); agency-level numbers may substitute if Sharan supplies them.
- **Visual direction** (implementation round): light hero, dot pattern + grid — deliberately different from the dark app. Product-shot images must match the real dashboard's dark-glass UI so they stay honest.

## Page structure

1. Hero
2. Testimonial 1 (directly under hero — logo ticker was cut: hero avatars already carry client proof)
3. Dashboard image (full-width, no copy)
4. Top 4 features
5. Testimonial 2
6. How it works (3 steps)
7. Testimonial 3
8. Final CTA
9. Footer

## Section 1 — Hero

> **Optimize your ad account for L2 conversions — not cheap leads.**
>
> Right now, your budget goes to whichever ad has the lowest CPA — even when none of those leads buy your program. Trace follows every lead from ad click → L1 → L2 sale, so you double down on the ads that bring real L2 buyers.
>
> **[ Request Access ]**
> Zero setup on your side
>
> [avatars] Loved by 25+ coaches & course creators

Structure: command headline (the smarter way to operate) + mirror sub (states what the reader already does, then resolves it with Trace). Microcopy is single-beat; scarcity lives in How-it-works step 1 and the final CTA.

## Testimonial slots 1 / 2 / 3 — templates (real quotes only)

Rule: genuine client quotes, tightened without changing meaning. Attribution = face photo + name + business. Best quotes contain a number. The "example shape" lines below are rhythm illustrations only — never publish them.

- **Slot 1 — under hero.** Job: prove the hero's promise (found the truth about their ads). Must contain a specific decision made from Trace data, ideally with a ₹ or % number.
  *Example shape:* "Meta showed 4 winning ad sets. Trace showed 2 of them hadn't made a single sale. We moved ₹60k/month."
- **Slot 2 — after features.** Job: kill the setup/effort objection. Must contain how little the client had to do.
  *Example shape:* "I didn't touch a pixel. They set it up and the dashboard just started filling in."
- **Slot 3 — after How it works.** Job: the after-state — confidence/scale once they knew their winners.
  *Example shape:* "First month we found our real winner and put 3x the budget on it. Best month we've had."

## Section 3 — Dashboard mock

No copy. Full-width **coded** product mock (decided 2026-08-10 — no Gemini image; a coded dark-glass dashboard matches the page and the real product): sidebar nav, KPI row (L2/L1 revenue, sessions, L2 ROAS), indigo L2 revenue chart over slate L1 baseline, top-ads-by-L2 list. Grows 80%→100% width on scroll. Numbers illustrative.

## Section 4 — Top 4 features

H2: **What you'll see in week one**

Layout: each block pairs copy with a **CSS micro-infographic tile** (decided 2026-08-10 at build — no Gemini images for this section; the coded tiles with illustrative numbers communicate at a glance). Flagship tile shows the core insight: highest-CPA ad wins L2 revenue, cheapest-CPA ad earns ₹0.

> **Every sale, matched to its ad** — Each payment is matched to the exact ad, ad set, and campaign that caused it. Not modeled. Matched.
>
> **Winners ranked by L2 revenue** — Your top ads ranked by the program revenue they actually produced — not clicks, not cheap leads, not Meta's "results".
>
> **See where buyers drop** — Follow every visitor from page load to payment. Find the exact step where people leave — and fix it.
>
> **We do the wiring** — Trace goes into your funnel and your payment gateway, set up by us. No pixels to debug. You just open the dashboard.

Deliberately no Meta spend/ROAS-sync claim — Slice B (Meta sync) isn't live. Spend is known at agency level (Sharan runs the clients' ads).

## Section 6 — How it works

H2: **How it works**

Layout: each step pairs copy with an image — placeholders `[how-img-1..3]`.

No time/waiting language anywhere in this section (Sharan: "30-day waiting is a deal breaker for many").

> **1 · Request access** — We onboard 4 clients a month. If there's a slot, we get on a call and map your funnel.
>
> **2 · We wire it in** — Trace goes into your landing pages and your payment gateway. Zero effort on your end — you don't touch a thing.
>
> **3 · Watch the money trail** — From the first click, every lead and payment flows in with the ad it came from. Winners rise to the top. Scale them, kill the rest.
>
> [ Request Access ]

## Section 8 — Final CTA

> **Every month, your budget buys more cheap leads that never convert.**
>
> 30 days from now you could know exactly which ads bring L2 buyers — or still be scaling on CPA.
>
> **[ Request Access ]**
> Only 4 slots left this month

("30 days from now" is intentional here — the no-waiting rule applies to How it works only. The slots count is the live, editable value.)

## Section 9 — Footer

Minimal: logo + tagline **"Every sale. Traced."** (locked 2026-08-10; replaces "Payment-level ad attribution for course businesses") + Request Access link + © — contact email dropped at review. Reserve line for social cards / meta description: "Clicks lie. Payments don't."

## Copy claims audit (all true as of approval)

- 4/month onboarding cap — Sharan-confirmed.
- No lock-in policy — Sharan-confirmed (unstated on page by his choice).
- 25+ clients — Sharan-confirmed.
- "Winners ranked by L2 revenue" — real dashboard capability (Overview L1/L2 KPIs + top-ads table).
- No setup-time claim, no spend-sync claim, no fabricated testimonials (slots stay empty until real quotes arrive), no DB revenue claim.

## Before implementation (open items)

1. Sharan collects: 3 real testimonial quotes matching the slot templates, client face photos (hero avatars).
2. Where the page lives: route in this repo vs separate site/domain — undecided.
3. Where "Request Access" submissions go: form → email? Supabase table (would need a deliberate `WITH CHECK` write policy or an anon-insert-only table — see auth rules)? Typeform? — undecided.
4. Visual design round: light hero with dot pattern + grid; bring options to Sharan first per `.claude/rules/workflow.md`.
5. Images: possibly none. Dashboard shot and feature blocks are coded (2026-08-10). `[how-img-1..3]` also have coded step-tiles built; Gemini generation only if Sharan wants to replace them.

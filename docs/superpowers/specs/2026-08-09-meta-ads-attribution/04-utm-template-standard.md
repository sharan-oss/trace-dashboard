# 04. UTM Template Standard: one URL template for every client

Child of [index.md](index.md). An operational standard for Ads Manager, not dashboard code. Decided with Sharan on 2026-08-09 during the Love School normalisation.

## Summary

Every client's Meta ads use one URL parameter template whose job is guaranteeing the three Meta identifiers on every click. Once the ids arrive, the `ads` table resolves names, so how a client spells `utm_source` stops mattering. This ends the era where each client invented their own convention (Love School and Occultyogis ran two incompatible ones, which is why the read layer needs repair rules at all).

## The template

Paste into the ad level URL parameters field in Ads Manager:

```
utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&fbc_id={{adset.id}}&h_ad_id={{ad.id}}
```

Why these choices:

- `{{site_source_name}}` puts the real platform (`fb`, `ig`, `an`, `msg`) in `utm_source` instead of a hand typed brand label (`METAxAM`, `MetaAM`, `FacebookSCLX` were three spellings of one thing, none saying which platform).
- `{{placement}}` keeps the Reels / Stories / Feed breakdown, which was Love School's most useful signal and which earlier template drafts dropped.
- The name macros keep URLs human readable; the id macros (`campaign_id`, `fbc_id`, `h_ad_id`) are what attribution actually joins on. No duplicated macros (the old templates carried `{{ad.id}}` twice and `{{ad.name}}` twice under different spellings).
- The id parameter names match what the shipped `metric_*` extraction already reads, so no dashboard code changes when a client adopts it.

## Hard rule: no `&` in Meta names

Never put `&` in a Meta campaign, ad set or ad name. Meta does not encode macro output, so an `&` inside a name splits the URL mid value. This is live data loss today: Occultyogis's campaign `... - AT - Beh&DD- Pros - CBO - ...` truncates `utm_campaign` at `Beh` and sprays the remainder into `utm_params` as junk keys. Audit existing names when applying the template and rename any that contain `&`.

## Rollout

1. Apply the template to every active client (Love School, Occultyogis Vastu, The Batra Numerology, MNW) at the ad account or campaign level in Ads Manager. Sharan's action, no code.
2. Rename any Meta campaign, ad set or ad containing `&`.
3. Until Trace's capture writes the ids into the stored `campaign_id` / `adset_id` / `ad_id` columns, new rows resolve through the views' extraction bridge, which already reads every parameter this template emits.
4. New client onboarding: seed their hierarchy into `ads` from a one time Ads Manager export (the same path Love School used, migration `seed_love_school_ads` as the pattern) until the child 02 sync covers them.

## Rationale

The deeper problem was never one wrong template; it was that the same UTM slot meant different things per client (`utm_medium` carried placement for one and campaign names for another, `utm_term` carried the adset id in one era and the adset name in another). No naming convention fixes that retroactively, and any convention drifts. Identifiers do not drift: with all three ids guaranteed, every future row resolves by exact join, names become display labels supplied by the `ads` table, and the scoped name matching in child 01 becomes a legacy bridge for history rather than a load bearing rule. Verified against Love School's live data: id extraction plus the seeded hierarchy resolved 98 percent of paid sessions to the exact ad.

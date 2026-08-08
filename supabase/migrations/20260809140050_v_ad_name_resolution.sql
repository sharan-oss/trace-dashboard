-- Which (client, campaign, ad name) triples are unambiguous, and what ad
-- they resolve to. Extracted out of v_sessions_attributed's inline CTE into
-- its own view so the two guards that protect against tenant-mixing are
-- directly queryable and testable on their own, not just embedded in SQL
-- text nobody exercises:
--
--   1. THE AMBIGUITY GUARD (`having count(distinct meta_ad_id) = 1`): ad
--      names are not unique. 14 of Love School's 49 names are reused across
--      ads, and one name is duplicated inside a single campaign. A triple
--      that maps to more than one ad must resolve to NOTHING rather than
--      being guessed, so it is dropped here, not merely deprioritized.
--   2. THE CROSS-TENANT GUARD (`client_id` in the grouping key): an admin
--      can see every client's ads. Without client_id in the group by, one
--      client's ad name could match another client's ad of the same name.
--
-- Both `ad_name` here and the `utm_content` probe on the sessions side go
-- through metric_normalize_key, so the comparison is symmetric. Without that,
-- an ad name differing only by surrounding whitespace could split into two
-- groups that each pass the uniqueness check, and a normalized utm_content
-- would then match one of them -- quietly sidestepping the ambiguity guard.
--
-- security_invoker = true: RLS on `ads` (admin sees all, a client sees only
-- its own) must apply to whoever queries this view, not its owner.
create or replace view public.v_ad_name_resolution
with (security_invoker = true) as
select client_id, meta_campaign_id, ad_name, min(meta_ad_id) as meta_ad_id
from (
  select
    client_id,
    meta_campaign_id,
    meta_ad_id,
    public.metric_normalize_key(ad_name) as ad_name
  from public.ads
  where meta_campaign_id is not null
) normalized
where ad_name is not null
group by client_id, meta_campaign_id, ad_name
having count(distinct meta_ad_id) = 1;

grant select on public.v_ad_name_resolution to anon, authenticated;

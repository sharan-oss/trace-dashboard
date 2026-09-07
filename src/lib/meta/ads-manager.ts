/**
 * Deep links into Meta Ads Manager.
 *
 * The escape hatch for anything the dashboard cannot show: full video, carousel
 * frames, the live creative as it actually renders. Costs no API call and never
 * goes stale, because Meta resolves the ad id at click time.
 *
 * Only useful to a viewer who holds a role on that ad account — Meta shows its
 * own error otherwise — so surface it as an optional action, never as the way
 * a creative is meant to be seen.
 *
 * PASS THE CAMPAIGN ID. `selected_ad_ids` on its own does not narrow anything:
 * Ads Manager resolves it against the account's unfiltered ad list, so the
 * viewer lands in every ad on the account (~1,200 for Love School) and has to
 * hunt for the one they were sent. Adding `selected_campaign_ids` scopes the
 * view to the parent campaign first, and the ad is then selected inside it.
 * Meta documents none of these query params — this is field-verified behaviour
 * (Sharan, 2026-09-07), so treat it as a fact about the product, not a spec,
 * and re-check it if links ever start landing wrong. `ads.meta_adset_id` is
 * available if the chain ever needs the middle step too.
 *
 * The account MUST be the one that owns this ad. A client can have several
 * (Love School has two), and an `act=` that does not own `selected_ad_ids`
 * gives an empty selection or Meta's own error — silently, which is how that
 * bug survived. Callers resolve the ad's own account; never a default one.
 */
export function adsManagerUrl(
  metaAdAccountId: string | null | undefined,
  metaAdId: string | null | undefined,
  metaCampaignId?: string | null,
): string | null {
  if (metaAdAccountId == null || metaAdId == null) return null;
  // Ads Manager wants the bare numeric account id; our column stores act_<id>.
  const account = metaAdAccountId.replace(/^act_/, "");
  if (account === "" || metaAdId === "") return null;
  const params = new URLSearchParams({ act: account });
  // Omitted rather than sent empty when unknown: the link then degrades to the
  // old account-wide behaviour instead of breaking outright.
  if (metaCampaignId != null && metaCampaignId !== "") {
    params.set("selected_campaign_ids", metaCampaignId);
  }
  params.set("selected_ad_ids", metaAdId);
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?${params.toString()}`;
}

/**
 * Resolves an ad's own account uuid to the `act_…` id the link needs.
 *
 * The fallback is deliberately narrow. When the owning account is unknown (a
 * breakdown-only ad, with no dimension row) it answers only if the client has
 * exactly ONE account, where the guess cannot be wrong. With several it returns
 * null and the link is hidden — because picking a default is precisely the bug
 * this replaces: Love School's Ads page linked all 1,258 ads through the
 * account that owns 1,155 of them, so the other 103 pointed at an account that
 * does not contain them, with no error to notice. A missing link is recoverable;
 * a confidently wrong one is not.
 */
export function makeAdAccountResolver(
  accounts: ReadonlyArray<{ id: string; meta_ad_account_id: string }>,
): (adAccountId: string | null) => string | null {
  const byId = new Map(accounts.map((a) => [a.id, a.meta_ad_account_id]));
  const only = accounts.length === 1 ? accounts[0].meta_ad_account_id : null;
  return (adAccountId) =>
    adAccountId == null ? only : (byId.get(adAccountId) ?? only);
}

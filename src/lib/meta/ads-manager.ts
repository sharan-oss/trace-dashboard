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
 */
export function adsManagerUrl(
  metaAdAccountId: string | null | undefined,
  metaAdId: string | null | undefined,
): string | null {
  if (metaAdAccountId == null || metaAdId == null) return null;
  // Ads Manager wants the bare numeric account id; our column stores act_<id>.
  const account = metaAdAccountId.replace(/^act_/, "");
  if (account === "" || metaAdId === "") return null;
  const params = new URLSearchParams({
    act: account,
    selected_ad_ids: metaAdId,
  });
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?${params.toString()}`;
}

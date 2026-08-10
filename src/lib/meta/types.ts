/** Response shapes for the three Graph API endpoints this project reads. */

export type MetaPaging = {
  cursors?: { before?: string; after?: string };
  next?: string;
};

export type MetaListResponse<T> = {
  data: T[];
  paging?: MetaPaging;
};

export type MetaAdAccount = {
  /** Prefixed form, e.g. "act_1052790390047154". */
  id: string;
  account_id?: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status?: number;
  /** The business that OWNS the account — for partner-shared accounts this is
   * the client's Business, not ours. */
  business?: { id: string; name?: string };
};

export type MetaAdRef = { id: string; name: string };

export type MetaAdCreative = {
  id: string;
  thumbnail_url?: string;
  image_url?: string;
  image_hash?: string;
};

export type MetaAd = {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  adset?: MetaAdRef;
  campaign?: MetaAdRef;
  creative?: MetaAdCreative;
};

export type MetaInsightRow = {
  ad_id: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  /** Hierarchy names ride along so spend on DELETED ads (unlistable via /ads)
   * can still synthesize a dimension row instead of being orphaned. */
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
};

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
  video_id?: string;
  /** Classic (non-dynamic) ads: the advertiser's chosen poster lives here. */
  object_story_spec?: {
    video_data?: { image_hash?: string; image_url?: string; video_id?: string };
    link_data?: { image_hash?: string; picture?: string };
    photo_data?: { image_hash?: string };
  };
  /** Advantage+/dynamic ads populate ONLY this, leaving the fields above null. */
  asset_feed_spec?: {
    images?: { hash?: string; url?: string }[];
    videos?: { video_id?: string; thumbnail_url?: string; thumbnail_hash?: string }[];
  };
};

/** One row of the account's image library (/act_X/adimages). */
export type MetaAdImage = {
  hash: string;
  /** Documented "A permanent URL of the image" — unlike `url`, which is temporary. */
  permalink_url?: string;
  url?: string;
  width?: number;
  height?: number;
};

/** One row of the account's video library (/act_X/advideos). */
export type MetaAdVideo = {
  id: string;
  /** Can be a grey "still processing" placeholder — prefer thumbnails.data[0].uri. */
  picture?: string;
  thumbnails?: { data?: { uri?: string; width?: number; is_preferred?: boolean }[] };
  format?: { picture?: string; width?: number; height?: number }[];
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

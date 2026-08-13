"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchX } from "lucide-react";
import { AdCard, statusGroup, type AdCardData } from "@/components/ads/ad-card";
import { Button } from "@/components/ui/button";
import { formatCount, formatINR } from "@/lib/format";
import { cpa, roas } from "@/lib/metrics/definitions";

/**
 * The Ads view: creative cards with client-side refinements. The campaign
 * filter is the one filter that travels in the URL (?campaign=) — it is how
 * the Campaigns view drills through and must survive sharing. Ad set, status,
 * search, sort and the zero-activity toggle are local state.
 *
 * The filtered-total strip recomputes from the visible set — the same paise
 * integers the cards show, summed client-side for display only (all real
 * aggregation stays in Postgres). The unattributed banner appears only with
 * no campaign filter: unattributed revenue belongs to no campaign by
 * definition, so inside a campaign filter its absence is correct, not a gap.
 */

type CampaignOption = { key: string; name: string };

type SortKey = "spend" | "roas" | "cpa" | "ctr" | "l1";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "roas", label: "ROAS" },
  { value: "cpa", label: "CPA" },
  { value: "ctr", label: "CTR" },
  { value: "l1", label: "L1 revenue" },
];

const PAGE_SIZE = 48;

/** Best-first comparator value; null sorts last for every key. */
function sortValue(ad: AdCardData, key: SortKey): number | null {
  switch (key) {
    case "spend":
      return ad.spendPaise;
    case "roas":
      return roas(ad.l1RevenuePaise + ad.l2RevenuePaise, ad.spendPaise);
    case "cpa": {
      const v = cpa(ad.spendPaise, ad.l1PaidCount);
      return v == null ? null : -v; // lower CPA is better
    }
    case "ctr":
      return ad.impressions > 0 ? ad.clicks / ad.impressions : null;
    case "l1":
      return ad.l1RevenuePaise;
  }
}

const selectClass =
  "rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 outline-none focus:border-indigo-500/50 [&>option]:bg-slate-900";

export function AdCards({
  ads,
  campaigns,
  activeCampaign,
  spendUntrackedPaise,
  unattributedL1RevenuePaise,
  unattributedL1Count,
}: {
  ads: AdCardData[];
  campaigns: CampaignOption[];
  /** campaign_key from the URL, or null = all campaigns. */
  activeCampaign: string | null;
  spendUntrackedPaise: number;
  unattributedL1RevenuePaise: number;
  unattributedL1Count: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [adset, setAdset] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spend");
  const [showZeroActivity, setShowZeroActivity] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // A changed filter restarts pagination; ad-set picks are campaign-scoped.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeCampaign, adset, status, query, sort, showZeroActivity]);
  useEffect(() => {
    setAdset("all");
  }, [activeCampaign]);

  function setCampaign(key: string) {
    const params = new URLSearchParams(searchParams);
    if (key === "all") params.delete("campaign");
    else params.set("campaign", key);
    params.set("tab", "ads");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const inCampaign = useMemo(
    () =>
      activeCampaign == null
        ? ads
        : ads.filter((a) => a.campaignKey === activeCampaign),
    [ads, activeCampaign],
  );

  const adsetOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of inCampaign) {
      if (a.adsetKey != null && !seen.has(a.adsetKey)) {
        seen.set(a.adsetKey, a.adsetName ?? a.adsetKey);
      }
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [inCampaign]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = inCampaign.filter((a) => {
      if (!showZeroActivity && !a.hasActivity) return false;
      if (adset !== "all" && a.adsetKey !== adset) return false;
      if (status !== "all" && statusGroup(a.status) !== status) return false;
      if (q !== "" && !(a.adName ?? a.adKey).toLowerCase().includes(q)) return false;
      return true;
    });
    return list.sort((x, y) => {
      const xv = sortValue(x, sort);
      const yv = sortValue(y, sort);
      if (xv == null && yv == null) return 0;
      if (xv == null) return 1;
      if (yv == null) return -1;
      return yv - xv;
    });
  }, [inCampaign, adset, status, query, sort, showZeroActivity]);

  const totals = useMemo(() => {
    let spend = 0;
    let l1 = 0;
    let l1Count = 0;
    let l2 = 0;
    for (const a of filtered) {
      spend += a.spendPaise;
      l1 += a.l1RevenuePaise;
      l1Count += a.l1PaidCount;
      l2 += a.l2RevenuePaise;
    }
    return {
      spend,
      l1,
      roas: roas(l1 + l2, spend),
      cpa: cpa(spend, l1Count),
    };
  }, [filtered]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Campaign"
          value={activeCampaign ?? "all"}
          onChange={(e) => setCampaign(e.target.value)}
          className={selectClass}
        >
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Ad set"
          value={adset}
          onChange={(e) => setAdset(e.target.value)}
          className={selectClass}
        >
          <option value="all">All ad sets</option>
          {adsetOptions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={selectClass}
        >
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="inactive">Inactive</option>
        </select>
        <input
          type="search"
          aria-label="Search ads by name"
          placeholder="Search ads…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-40 flex-1 rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-indigo-500/50 sm:max-w-60"
        />
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          Sort by
          <select
            aria-label="Sort ads"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={selectClass}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showZeroActivity}
            onChange={(e) => setShowZeroActivity(e.target.checked)}
            className="accent-indigo-500"
          />
          Zero-activity ads
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-white/5 px-4 py-2.5 text-xs text-slate-400 backdrop-blur-md">
        <span className="font-medium text-slate-300">
          {formatCount(filtered.length)} ads
        </span>
        <span>
          Spend <span className="text-slate-300 tabular-nums">{formatINR(totals.spend)}</span>
        </span>
        <span>
          L1 <span className="text-slate-300 tabular-nums">{formatINR(totals.l1)}</span>
        </span>
        <span>
          ROAS{" "}
          <span className="text-slate-300 tabular-nums">
            {totals.roas == null ? "n/a" : `${totals.roas.toFixed(2)}×`}
          </span>
        </span>
        <span>
          CPA{" "}
          <span className="text-slate-300 tabular-nums">
            {totals.cpa == null ? "n/a" : formatINR(Math.round(totals.cpa))}
          </span>
        </span>
        <span className="ml-auto hidden text-slate-600 sm:inline">
          Totals reflect the current filters
        </span>
      </div>

      {activeCampaign == null &&
        (unattributedL1RevenuePaise > 0 || spendUntrackedPaise > 0) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-warning-foreground/15 bg-warning px-4 py-2.5 text-xs text-slate-400">
            <span
              className="font-medium text-warning-foreground"
              title="Revenue and spend no individual ad can claim — always shown, never hidden inside a card"
            >
              Not attributable to any ad
            </span>
            <span>
              Unattributed L1 revenue{" "}
              <span className="text-slate-300 tabular-nums">
                {formatINR(unattributedL1RevenuePaise)}
              </span>{" "}
              ({formatCount(unattributedL1Count)} payments)
            </span>
            <span>
              Spend with no tracked sessions{" "}
              <span className="text-slate-300 tabular-nums">
                {formatINR(spendUntrackedPaise)}
              </span>
            </span>
          </div>
        )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <SearchX size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">No ads match the current filters.</p>
          {!showZeroActivity && (
            <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">
              Ads with no spend, revenue or sessions in this range are hidden —
              tick “Zero-activity ads” to include them.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((ad) => (
              <AdCard key={ad.adKey} ad={ad} />
            ))}
          </div>
          {filtered.length > visibleCount && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              >
                Show more ({formatCount(filtered.length - visibleCount)} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

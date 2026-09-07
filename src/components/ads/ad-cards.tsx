"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { AdCard, statusGroup, type AdCardData } from "@/components/ads/ad-card";
import { Button } from "@/components/ui/button";
import { formatCount, formatINR } from "@/lib/format";
import { cpa, roas } from "@/lib/metrics/definitions";
import { cn } from "@/lib/utils";

/**
 * The Ads view: creative cards with client-side refinements. The campaign
 * filter is the one filter that travels in the URL (?campaign=) — it is how
 * the Campaigns view drills through and must survive sharing. Ad set, status,
 * search, sort and the zero-activity toggle are local state.
 *
 * Toolbar doctrine (2026-08-13 polish round): ONE control row, every control
 * h-9 on the same glass recipe, compact intrinsic widths — filters read
 * left-to-right, sort sits right with an explicit direction toggle, and a
 * Reset appears only once something deviates from the defaults. Status is a
 * segmented control, matching the app's existing DateRangePicker/AdsTabs
 * pattern rather than inventing a new one.
 *
 * The filtered-total strip recomputes from the visible set — the same paise
 * integers the cards show, summed client-side for display only (all real
 * aggregation stays in Postgres). The unattributed banner appears only with
 * no campaign filter: unattributed revenue belongs to no campaign by
 * definition, so inside a campaign filter its absence is correct, not a gap.
 */

type CampaignOption = { key: string; name: string };

type SortKey = "spend" | "roas" | "cpa" | "ctr" | "l1" | "l2";
type SortDir = "desc" | "asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "roas", label: "ROAS" },
  { value: "cpa", label: "CPA" },
  { value: "ctr", label: "CTR" },
  { value: "l1", label: "L1 revenue" },
  { value: "l2", label: "L2 revenue" },
];

/** "Best first" per metric — what a fresh sort selection means. */
const BEST_DIR: Record<SortKey, SortDir> = {
  spend: "desc",
  roas: "desc",
  cpa: "asc", // a cheap buyer is a good buyer
  ctr: "desc",
  l1: "desc",
  l2: "desc",
};

const STATUS_SEGMENTS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "inactive", label: "Inactive" },
] as const;

const PAGE_SIZE = 48;

/** Raw metric value for sorting; null means "no basis" and always sorts last. */
function sortValue(ad: AdCardData, key: SortKey): number | null {
  switch (key) {
    case "spend":
      return ad.spendPaise;
    case "roas":
      return roas(ad.l1RevenuePaise + ad.l2RevenuePaise, ad.spendPaise);
    case "cpa":
      return cpa(ad.spendPaise, ad.l1PaidCount);
    case "ctr":
      return ad.impressions > 0 ? ad.clicks / ad.impressions : null;
    case "l1":
      return ad.l1RevenuePaise;
    case "l2":
      return ad.l2RevenuePaise;
  }
}

const controlClass =
  "h-9 rounded-lg border border-border bg-white/5 text-xs text-slate-300 outline-none transition-colors focus-within:border-indigo-500/50";

function ToolbarSelect({
  label,
  value,
  onChange,
  children,
  className,
  active,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  /** Non-default value — tinted so applied filters stay visible at a glance. */
  active?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          controlClass,
          "w-full cursor-pointer appearance-none truncate py-0 pr-8 pl-3 focus:border-indigo-500/50",
          active && "border-indigo-500/40 text-indigo-200",
          "[&>option]:bg-slate-900",
        )}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500"
      />
    </span>
  );
}

function StripMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 tabular-nums">{children}</span>
    </span>
  );
}

export function AdCards({
  ads,
  campaigns,
  activeCampaign,
  spendUntrackedPaise,
  unattributedL1RevenuePaise,
  unattributedL1Count,
  unattributedL2RevenuePaise,
  unattributedL2Count,
  l2WindowLabel = null,
  metaAdAccountFor,
}: {
  ads: AdCardData[];
  campaigns: CampaignOption[];
  /** campaign_key from the URL, or null = all campaigns. */
  activeCampaign: string | null;
  spendUntrackedPaise: number;
  unattributedL1RevenuePaise: number;
  unattributedL1Count: number;
  unattributedL2RevenuePaise: number;
  unattributedL2Count: number;
  /** Set only in split-window mode: which window the L2 figures cover. */
  l2WindowLabel?: string | null;
  /** Resolves each ad's own account for its Ads Manager link; null hides it. */
  metaAdAccountFor?: (adAccountId: string | null) => string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [adset, setAdset] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("spend");
  const [dir, setDir] = useState<SortDir>("desc");
  const [showZeroActivity, setShowZeroActivity] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // A changed filter restarts pagination; ad-set picks are campaign-scoped.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeCampaign, adset, status, query, sort, dir, showZeroActivity]);
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

  function pickSort(key: SortKey) {
    setSort(key);
    setDir(BEST_DIR[key]);
  }

  const filtersDirty =
    activeCampaign != null ||
    adset !== "all" ||
    status !== "all" ||
    query !== "" ||
    showZeroActivity;

  function resetFilters() {
    setAdset("all");
    setStatus("all");
    setQuery("");
    setShowZeroActivity(false);
    if (activeCampaign != null) setCampaign("all");
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
    const sign = dir === "desc" ? -1 : 1;
    return list.sort((x, y) => {
      const xv = sortValue(x, sort);
      const yv = sortValue(y, sort);
      if (xv == null && yv == null) return 0;
      if (xv == null) return 1; // n/a last, in either direction
      if (yv == null) return -1;
      return sign * (xv - yv);
    });
  }, [inCampaign, adset, status, query, sort, dir, showZeroActivity]);

  const zeroActivityHidden = useMemo(
    () => (showZeroActivity ? 0 : inCampaign.filter((a) => !a.hasActivity).length),
    [inCampaign, showZeroActivity],
  );

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
      l2,
      roas: roas(l1 + l2, spend),
      cpa: cpa(spend, l1Count),
    };
  }, [filtered]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(controlClass, "relative inline-flex w-full items-center sm:w-56")}>
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 text-slate-500"
          />
          <input
            type="search"
            aria-label="Search ads by name"
            placeholder="Search ads…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-full w-full bg-transparent pr-3 pl-9 text-xs text-slate-300 outline-none placeholder:text-slate-600"
          />
        </span>

        <ToolbarSelect
          label="Campaign"
          value={activeCampaign ?? "all"}
          onChange={setCampaign}
          active={activeCampaign != null}
          className="max-w-64"
        >
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect
          label="Ad set"
          value={adset}
          onChange={setAdset}
          active={adset !== "all"}
          className="max-w-56"
        >
          <option value="all">All ad sets</option>
          {adsetOptions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </ToolbarSelect>

        <div
          role="group"
          aria-label="Status"
          className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5"
        >
          {STATUS_SEGMENTS.map((segment) => (
            <button
              key={segment.value}
              type="button"
              aria-pressed={status === segment.value}
              onClick={() => setStatus(segment.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                status === segment.value
                  ? "bg-accent text-accent-foreground"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {segment.label}
            </button>
          ))}
        </div>

        {filtersDirty && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 text-xs">
            <X size={14} aria-hidden="true" />
            Reset
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={cn(controlClass, "relative inline-flex items-stretch")}>
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500">
              Sort
            </span>
            <select
              aria-label="Sort ads by"
              value={sort}
              onChange={(e) => pickSort(e.target.value as SortKey)}
              className="cursor-pointer appearance-none bg-transparent py-0 pr-2 pl-12 text-xs text-slate-300 outline-none [&>option]:bg-slate-900"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={dir === "desc" ? "Sorted descending — switch to ascending" : "Sorted ascending — switch to descending"}
              title={dir === "desc" ? "Descending" : "Ascending"}
              onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
              className="flex items-center border-l border-white/10 px-2.5 text-slate-400 transition-colors hover:text-white"
            >
              {dir === "desc" ? (
                <ArrowDownWideNarrow size={14} aria-hidden="true" />
              ) : (
                <ArrowUpNarrowWide size={14} aria-hidden="true" />
              )}
            </button>
          </span>

          <button
            type="button"
            role="switch"
            aria-checked={showZeroActivity}
            onClick={() => setShowZeroActivity((v) => !v)}
            className="group flex h-9 items-center gap-2 text-xs text-slate-400 transition-colors hover:text-slate-300"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative h-4.5 w-8 rounded-full border border-white/10 transition-colors",
                showZeroActivity ? "bg-accent" : "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 rounded-full bg-white transition-transform",
                  showZeroActivity && "translate-x-3.5",
                )}
              />
            </span>
            Zero-activity ads
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-white/5 px-4 py-2.5 text-xs backdrop-blur-md">
        <span className="font-semibold text-white">
          {formatCount(filtered.length)} ads
        </span>
        <StripMetric label="Spend">{formatINR(totals.spend)}</StripMetric>
        <StripMetric label="L1">{formatINR(totals.l1)}</StripMetric>
        <StripMetric label="L2">{formatINR(totals.l2)}</StripMetric>
        <StripMetric label="ROAS">
          {totals.roas == null ? "n/a" : `${totals.roas.toFixed(2)}×`}
        </StripMetric>
        <StripMetric label="CPA">
          {totals.cpa == null ? "n/a" : formatINR(Math.round(totals.cpa))}
        </StripMetric>
        {zeroActivityHidden > 0 && (
          <span className="text-slate-600">
            · {formatCount(zeroActivityHidden)} zero-activity hidden
          </span>
        )}
        <span className="ml-auto hidden text-slate-600 sm:inline">
          Totals reflect the current filters
        </span>
      </div>

      {activeCampaign == null &&
        (unattributedL1RevenuePaise > 0 ||
          unattributedL2RevenuePaise > 0 ||
          spendUntrackedPaise > 0) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-warning-foreground/15 bg-warning px-4 py-2.5 text-xs text-slate-400">
            <span
              className="font-medium text-warning-foreground"
              title="Revenue and spend no individual ad can claim — always shown, never hidden inside a card"
            >
              Not attributable to any ad
            </span>
            {l2WindowLabel != null && (
              <StripMetric label="L2 window">{l2WindowLabel}</StripMetric>
            )}
            <StripMetric label="Unattributed L1">
              {formatINR(unattributedL1RevenuePaise)} ({formatCount(unattributedL1Count)}{" "}
              payments)
            </StripMetric>
            {unattributedL2RevenuePaise > 0 && (
              <StripMetric label="Unattributed L2">
                {formatINR(unattributedL2RevenuePaise)} ({formatCount(unattributedL2Count)})
              </StripMetric>
            )}
            <StripMetric label="Spend, no tracked sessions">
              {formatINR(spendUntrackedPaise)}
            </StripMetric>
          </div>
        )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <SearchX size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">No ads match the current filters.</p>
          {!showZeroActivity && (
            <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">
              Ads with no spend, revenue or sessions in this range are hidden —
              switch on “Zero-activity ads” to include them.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-1 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((ad) => (
              <AdCard key={ad.adKey} ad={ad} metaAdAccountFor={metaAdAccountFor} />
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

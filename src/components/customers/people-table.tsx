"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { AdPeek } from "@/components/customers/ad-peek";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { avatarDataUri } from "@/lib/avatars";
import type { AdCreativeMeta } from "@/lib/creatives";
import {
  formatCount,
  formatDayShort,
  formatDays,
  formatINR,
} from "@/lib/format";
import {
  PEOPLE_PAGE_SIZE,
  type CustomerRow,
  type PeopleSort,
  type SortDir,
} from "@/lib/queries/customers";
import { cn } from "@/lib/utils";

/**
 * The People table: every customer in the cohort, LTV-first. All refinements —
 * search, sort, direction, repeat-only, page — live in the URL and are applied
 * SERVER-side (the table receives one pre-filtered page of 50), so views are
 * shareable and no read can hit PostgREST's 1000-row cap.
 *
 * Toolbar follows the 2026-08-13 Ads recipe: one control row, everything h-9
 * on the same glass, Reset appears only once something deviates. Sort defaults
 * are best-first per metric (fastest-to-upsell ascends — a fast second
 * purchase is a good one).
 *
 * A row is a link to ?customer=<id>, opening the detail sheet — URL-driven
 * like every other drill-down in the app, so a specific person is shareable.
 */

const SORT_OPTIONS: { value: PeopleSort; label: string }[] = [
  { value: "ltv", label: "Highest LTV" },
  { value: "newest", label: "Newest" },
  { value: "fastest", label: "Fastest to upsell" },
];

const BEST_DIR: Record<PeopleSort, SortDir> = {
  ltv: "desc",
  newest: "desc",
  fastest: "asc",
};

const glass =
  "h-9 rounded-lg border border-border bg-white/5 text-xs text-slate-300 transition-colors";

export function PeopleTable({
  rows,
  total,
  page,
  search,
  sort,
  dir,
  repeatOnly,
  creativeMeta,
}: {
  rows: CustomerRow[];
  total: number;
  page: number;
  search: string;
  sort: PeopleSort;
  dir: SortDir;
  repeatOnly: boolean;
  creativeMeta: Record<string, AdCreativeMeta>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(search);

  // Debounced search → URL. replace (not push) so typing does not spam
  // history; every change resets to page 0, or filtered pages could be empty.
  useEffect(() => {
    if (searchDraft === search) return;
    const t = setTimeout(() => {
      navigate({ q: searchDraft, page: null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate reads
    // fresh params at call time; searchDraft/search are the real inputs.
  }, [searchDraft, search]);

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "people");
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function customerHref(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "people");
    next.set("customer", id);
    return `${pathname}?${next.toString()}`;
  }

  const isDefault =
    search === "" && sort === "ltv" && dir === "desc" && !repeatOnly && page === 0;

  const firstShown = total === 0 ? 0 : page * PEOPLE_PAGE_SIZE + 1;
  const lastShown = Math.min((page + 1) * PEOPLE_PAGE_SIZE, total);
  const hasPrev = page > 0;
  const hasNext = lastShown < total;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white">People</CardTitle>
        <CardDescription className="text-sm text-slate-400">
          Everyone whose first purchase falls in this range, with their full
          lifetime value
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Toolbar — one h-9 glass row, per the Ads recipe. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className={cn(glass, "flex items-center gap-2 px-3")}>
            <Search size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Name or email"
              aria-label="Search customers by name or email"
              className="w-36 bg-transparent text-xs text-white placeholder:text-slate-600 focus:outline-none"
            />
          </label>

          <select
            value={sort}
            onChange={(e) => {
              const next = e.target.value as PeopleSort;
              navigate({ sort: next, dir: BEST_DIR[next], page: null });
            }}
            aria-label="Sort customers"
            className={cn(glass, "cursor-pointer appearance-none px-3 pr-7")}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => navigate({ dir: dir === "desc" ? "asc" : "desc", page: null })}
            title={dir === "desc" ? "Descending — click for ascending" : "Ascending — click for descending"}
            aria-label="Toggle sort direction"
            className={cn(glass, "grid w-9 cursor-pointer place-items-center hover:text-white")}
          >
            {dir === "desc" ? (
              <ArrowDownWideNarrow size={14} aria-hidden="true" />
            ) : (
              <ArrowUpNarrowWide size={14} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={repeatOnly}
            onClick={() => navigate({ repeat: repeatOnly ? null : "1", page: null })}
            className={cn(
              glass,
              "flex cursor-pointer items-center gap-2 px-3",
              repeatOnly && "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
            )}
          >
            <span
              className={cn(
                "relative h-3.5 w-6 rounded-full transition-colors",
                repeatOnly ? "bg-indigo-500" : "bg-white/15",
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-0.5 size-2.5 rounded-full bg-white transition-all",
                  repeatOnly ? "left-3" : "left-0.5",
                )}
              />
            </span>
            Repeat buyers
          </button>

          {!isDefault && (
            <button
              type="button"
              onClick={() => {
                setSearchDraft("");
                navigate({ q: null, sort: null, dir: null, repeat: null, page: null });
              }}
              className={cn(glass, "flex cursor-pointer items-center gap-1.5 px-3 hover:text-white")}
            >
              <X size={12} aria-hidden="true" />
              Reset
            </button>
          )}

          <p className="ml-auto text-xs text-slate-500 tabular-nums">
            {total === 0
              ? "No matches"
              : `Showing ${formatCount(firstShown)}–${formatCount(lastShown)} of ${formatCount(total)}`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-190 text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Customer</th>
                <th className="py-2.5 pr-4 font-medium">Acquired via</th>
                <th className="py-2.5 pr-4 text-right font-medium">First purchase</th>
                <th className="py-2.5 pr-4 text-right font-medium">Purchases</th>
                <th className="py-2.5 pr-4 text-right font-medium">Days to upsell</th>
                <th className="py-2.5 text-right font-medium">LTV</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    {search !== "" || repeatOnly
                      ? "No customers match these filters."
                      : "No customers acquired in this range."}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.customer_id}
                  className="border-b border-white/5 text-slate-300 transition-colors last:border-0 hover:bg-white/3"
                >
                  <td className="py-2.5 pr-4">
                    <Link
                      href={customerHref(row.customer_id)}
                      scroll={false}
                      className="flex items-center gap-2.5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI */}
                      <img
                        src={avatarDataUri(row.customer_id)}
                        alt=""
                        width={32}
                        height={32}
                        className="size-8 shrink-0 rounded-full"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="truncate font-medium text-white"
                            title={row.name || "Unnamed customer"}
                          >
                            {row.name || "Unnamed customer"}
                          </span>
                          {row.has_test && <StatusBadge status="warning" label="Test" />}
                        </span>
                        {row.email_norm != null && (
                          <span className="block truncate text-[11px] text-slate-600">
                            {row.email_norm}
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="max-w-52 py-2.5 pr-4">
                    {row.ad_key != null || row.ad_name != null ? (
                      <span className="block truncate">
                        <AdPeek
                          label={row.ad_name ?? row.ad_key ?? ""}
                          meta={
                            row.ad_key != null
                              ? (creativeMeta[row.ad_key] ?? null)
                              : null
                          }
                        />
                      </span>
                    ) : (
                      <span
                        className="text-slate-600"
                        title="This customer's acquiring payment resolved to no ad"
                      >
                        no ad resolved
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {formatDayShort(row.acquired_day_ist)}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {formatCount(row.purchase_count)}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {row.days_to_second == null ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      formatDays(row.days_to_second)
                    )}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-white tabular-nums">
                    {formatINR(row.lifetime_paise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(hasPrev || hasNext) && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => navigate({ page: page - 1 > 0 ? String(page - 1) : null })}
              className={cn(
                glass,
                "flex items-center gap-1 px-3",
                hasPrev ? "cursor-pointer hover:text-white" : "cursor-default opacity-40",
              )}
            >
              <ChevronLeft size={13} aria-hidden="true" />
              Prev
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => navigate({ page: String(page + 1) })}
              className={cn(
                glass,
                "flex items-center gap-1 px-3",
                hasNext ? "cursor-pointer hover:text-white" : "cursor-default opacity-40",
              )}
            >
              Next
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

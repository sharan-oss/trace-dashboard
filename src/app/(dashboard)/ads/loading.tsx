import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoTile } from "@/components/ui/bento-tile";

/** Skeleton for the Ads page — the loading state, visibly distinct from empty. */
export default function AdsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8" aria-busy="true">
      <div>
        <div className="h-7 w-24 animate-pulse rounded bg-white/10" />
        <div className="mt-2 h-4 w-32 animate-pulse rounded bg-white/5" />
      </div>
      <BentoGrid className="auto-rows-[minmax(120px,auto)]">
        {Array.from({ length: 6 }).map((_, i) => (
          <BentoTile key={i} className="flex flex-col justify-between gap-5">
            <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            <div className="h-9 w-28 animate-pulse rounded bg-white/10" />
          </BentoTile>
        ))}
      </BentoGrid>
      <div className="h-80 animate-pulse rounded-2xl border border-border bg-card" />
    </div>
  );
}

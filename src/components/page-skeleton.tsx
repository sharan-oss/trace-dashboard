import type * as React from "react";
import { BentoGrid } from "@/components/ui/bento-grid";
import { BentoTile } from "@/components/ui/bento-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Building blocks for route loading.tsx files. Each page's skeleton mirrors
 * its real layout with the same grid and card classes and reserves real
 * heights, so nothing shifts when data lands. The title is the page's real
 * <h1>; data-skeleton marks the frame for tests and browser checks.
 */

export function PageSkeleton({
  title,
  controls = true,
  children,
}: {
  title: string;
  /** False when the page header has no date picker or buttons. */
  controls?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8" aria-busy="true" data-skeleton="">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <Skeleton className="mt-2 h-4 w-40 bg-white/5" />
        </div>
        {controls && <Skeleton className="h-8 w-64 rounded-lg" />}
      </header>
      {children}
    </div>
  );
}

export function KpiGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <BentoGrid className="auto-rows-[minmax(120px,auto)]">
      {Array.from({ length: count }, (_, i) => (
        <BentoTile key={i} className="flex flex-col justify-between gap-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-28" />
        </BentoTile>
      ))}
    </BentoGrid>
  );
}

export function TabsSkeleton() {
  return <Skeleton className="h-8 w-44 rounded-lg" />;
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-2xl border border-border bg-card motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function TableCardSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-border bg-card p-4 backdrop-blur-md"
    >
      <Skeleton className="mb-2 h-4 w-36" />
      <Skeleton className="mb-5 h-3 w-56 bg-white/5" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-16 bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

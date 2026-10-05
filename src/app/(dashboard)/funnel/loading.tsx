import { CardSkeleton, PageSkeleton, TableCardSkeleton } from "@/components/page-skeleton";

/** Funnel's loading frame: stage card, wasted-clicks strip, lens table. */
export default function FunnelLoading() {
  return (
    <PageSkeleton title="Funnel">
      <CardSkeleton className="h-56" />
      <CardSkeleton className="h-16" />
      <TableCardSkeleton />
    </PageSkeleton>
  );
}

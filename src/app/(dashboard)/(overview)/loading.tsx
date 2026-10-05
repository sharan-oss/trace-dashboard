import {
  CardSkeleton,
  KpiGridSkeleton,
  PageSkeleton,
  TableCardSkeleton,
} from "@/components/page-skeleton";

/** Overview's loading frame: KPI bento, revenue chart, top-ads table. */
export default function OverviewLoading() {
  return (
    <PageSkeleton title="Overview">
      <KpiGridSkeleton />
      <CardSkeleton className="h-80" />
      <TableCardSkeleton rows={6} />
    </PageSkeleton>
  );
}

import {
  CardSkeleton,
  KpiGridSkeleton,
  PageSkeleton,
  TableCardSkeleton,
  TabsSkeleton,
} from "@/components/page-skeleton";

/** Customers' loading frame: Value | People tabs, KPI bento, value bar, table. */
export default function CustomersLoading() {
  return (
    <PageSkeleton title="Customers">
      <TabsSkeleton />
      <KpiGridSkeleton />
      <CardSkeleton className="h-28" />
      <TableCardSkeleton />
    </PageSkeleton>
  );
}

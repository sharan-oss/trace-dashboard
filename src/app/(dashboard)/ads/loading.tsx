import {
  CardSkeleton,
  KpiGridSkeleton,
  PageSkeleton,
  TabsSkeleton,
} from "@/components/page-skeleton";

/** Skeleton for the Ads page — the loading state, visibly distinct from empty. */
export default function AdsLoading() {
  return (
    <PageSkeleton title="Ads">
      <TabsSkeleton />
      <KpiGridSkeleton />
      <CardSkeleton className="h-80" />
    </PageSkeleton>
  );
}

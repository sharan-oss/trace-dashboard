import { PageSkeleton, TableCardSkeleton } from "@/components/page-skeleton";

/** Sync log's loading frame: one runs table. */
export default function SyncLogLoading() {
  return (
    <PageSkeleton title="Sync log" controls={false}>
      <TableCardSkeleton rows={10} />
    </PageSkeleton>
  );
}

import { CardSkeleton, PageSkeleton, TableCardSkeleton } from "@/components/page-skeleton";

/** Users' loading frame: add-user card, access list. */
export default function UsersLoading() {
  return (
    <PageSkeleton title="Users" controls={false}>
      <CardSkeleton className="h-40" />
      <TableCardSkeleton rows={5} />
    </PageSkeleton>
  );
}

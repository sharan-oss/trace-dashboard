"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { useRunPending } from "@/components/navigation/pending-navigation";
import { buttonVariants } from "@/components/ui/button";

/**
 * A dashboard page failed to render. It sits under the layout, so the sidebar
 * stays usable; Try again re-fetches the segment (Next 16's unstable_retry —
 * reset() would re-render without re-fetching). The URL still holds every
 * filter, so retrying lands exactly where the user was.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // unstable_retry re-fetches inside Next's own transition, which nothing
  // observes; running it through the pending layer dims the page and runs the
  // bar, so Try again is acknowledged like every other click.
  const runPending = useRunPending();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <div
        role="alert"
        className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md"
      >
        <TriangleAlert size={24} className="mx-auto mb-3 text-danger-foreground" aria-hidden="true" />
        <h1 className="text-base font-semibold text-white">This page didn&apos;t load</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
          Something went wrong fetching its data. Your filters are kept, so
          trying again picks up where you were.
        </p>
        <button
          type="button"
          onClick={() => runPending(() => unstable_retry())}
          className={buttonVariants({ variant: "outline", className: "mt-5" })}
        >
          <RotateCw size={14} aria-hidden="true" />
          Try again
        </button>
        {error.digest && (
          <p className="mt-4 font-mono text-xs text-slate-600">Ref {error.digest}</p>
        )}
      </div>
    </div>
  );
}

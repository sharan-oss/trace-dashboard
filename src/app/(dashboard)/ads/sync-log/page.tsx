import { Fragment } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, CircleDashed, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { formatCount } from "@/lib/format";
import { getSyncRuns, type SyncRun } from "@/lib/queries/ads";
import { getClients } from "@/lib/queries/overview";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The sync audit trail — deliberately low-key, reachable only from the quiet
 * "Sync log" link on the Ads page. Every ad_sync_runs row for the selected
 * client, newest first, with the full error text inline when a run failed:
 * surfacing errors is this page's entire reason to exist, so they are never
 * truncated into a tooltip. Pure server render; refresh to update.
 */

const IST_STARTED = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function duration(run: SyncRun): string | null {
  if (run.finished_at == null) return null;
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function RunStatus({ status }: { status: SyncRun["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-400">
        <RefreshCw size={12} aria-hidden="true" className="animate-spin" />
        Running
      </span>
    );
  }
  if (status === "success") return <StatusBadge status="success" label="Success" />;
  if (status === "partial") return <StatusBadge status="warning" label="Partial" />;
  return <StatusBadge status="danger" label="Failed" />;
}

export default async function SyncLogPage() {
  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const cookieStore = await cookies();
  const selected = resolveSelectedClient(
    clients,
    cookieStore.get(CLIENT_COOKIE)?.value,
  );

  if (selected == null) {
    return (
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">Sync log</h1>
        <div className="rounded-2xl border border-border bg-card p-10 text-center backdrop-blur-md">
          <CircleDashed size={24} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-400">
            No clients are visible to this identity.
          </p>
        </div>
      </div>
    );
  }

  const runs = await getSyncRuns(supabase, selected.id);

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Sync log</h1>
          <p className="mt-0.5 text-sm text-slate-400">{selected.name}</p>
        </div>
        <Link
          href="/ads"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Back to Ads
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-white">
            Meta sync runs
          </CardTitle>
          <CardDescription className="text-sm text-slate-400">
            Last {runs.length < 50 ? runs.length : 50} runs · nightly cron fires
            2:30 AM IST · refresh the page for the latest
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-180 text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Started (IST)</th>
                <th className="py-2.5 pr-4 font-medium">Account</th>
                <th className="py-2.5 pr-4 font-medium">Kind</th>
                <th className="py-2.5 pr-4 font-medium">Window</th>
                <th className="py-2.5 pr-4 text-right font-medium">Duration</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 pr-4 text-right font-medium">Rows</th>
                <th className="py-2.5 text-right font-medium">API calls</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No sync runs yet for {selected.name}.
                  </td>
                </tr>
              )}
              {runs.map((run) => {
                const runDuration = duration(run);
                return (
                  <Fragment key={run.id}>
                    <tr
                      className={
                        run.error == null
                          ? "border-b border-white/5 text-slate-300 last:border-0"
                          : "text-slate-300"
                      }
                    >
                      <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                        {IST_STARTED.format(new Date(run.started_at))}
                      </td>
                      <td className="max-w-52 truncate py-2.5 pr-4" title={run.account_name}>
                        {run.account_name}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-400">{run.kind}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-slate-400 tabular-nums">
                        {run.date_from != null && run.date_to != null
                          ? `${run.date_from} → ${run.date_to}`
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {runDuration ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <RunStatus status={run.status} />
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {formatCount(run.rows_upserted)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatCount(run.api_calls)}
                      </td>
                    </tr>
                    {run.error != null && (
                      <tr className="border-b border-white/5 last:border-0">
                        <td
                          colSpan={8}
                          className="pt-0 pb-2.5 pl-4 text-xs break-all text-danger-foreground"
                        >
                          {run.error}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

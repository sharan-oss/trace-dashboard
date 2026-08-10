import { CircleDashed, RefreshCw } from "lucide-react";
import type { AdAccountSyncStatus } from "@/lib/queries/ads";
import { cn } from "@/lib/utils";

/**
 * Per-account sync freshness, keyed on the newest ad_sync_runs row with a
 * finished_at. A running row is "sync in progress" — deliberately distinct
 * from stale. Stale = nothing finished in >36h (the nightly runs at 2:30 AM
 * IST, so a healthy account is never more than ~26h behind). A client with
 * two accounts sees which one is behind.
 */
const STALE_AFTER_MS = 36 * 3_600_000;

function relative(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SyncStatusNote({ accounts }: { accounts: AdAccountSyncStatus[] }) {
  if (accounts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
      {accounts.map((account) => {
        if (account.running_now) {
          return (
            <span key={account.id} className="inline-flex items-center gap-1.5">
              <RefreshCw size={11} aria-hidden="true" className="animate-spin text-indigo-400" />
              {account.name}: sync in progress
            </span>
          );
        }
        if (account.last_finished_at == null) {
          return (
            <span key={account.id} className="inline-flex items-center gap-1.5">
              <CircleDashed size={11} aria-hidden="true" />
              {account.name}: never synced
            </span>
          );
        }
        const stale = Date.now() - Date.parse(account.last_finished_at) > STALE_AFTER_MS;
        return (
          <span
            key={account.id}
            className={cn(
              "inline-flex items-center gap-1.5",
              stale && "text-warning-foreground",
            )}
          >
            <CircleDashed size={11} aria-hidden="true" />
            {account.name}: synced {relative(account.last_finished_at)}
            {stale && " — stale"}
            {account.last_run_status === "partial" && " (partial)"}
            {account.last_run_status === "failed" && " (last run failed)"}
          </span>
        );
      })}
    </div>
  );
}

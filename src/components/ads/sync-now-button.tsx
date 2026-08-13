"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nightlyWindow } from "@/lib/meta/nightly";

/**
 * Manual sync trigger: every active account of the selected client,
 * sequentially, over the same trailing 28-day IST window the nightly uses —
 * upserts are idempotent, so overlapping the nightly costs nothing. Runs are
 * recorded kind='manual' so ad_sync_runs stays honest about what triggered
 * what.
 *
 * Auth happens server-side (requireCronOrAdmin → the Phase 0 dev identity);
 * the browser sends nothing but the same-origin request. A 409 means a run is
 * already in flight for that account — reported as status, never as an error.
 */

type AccountRef = { meta_ad_account_id: string; name: string };

export function SyncNowButton({
  accounts,
  anyRunning,
}: {
  accounts: AccountRef[];
  anyRunning: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const busy = progress != null;

  async function syncAll() {
    if (busy) return;
    setNotes([]);
    const { from, to } = nightlyWindow();
    const collected: string[] = [];

    for (const [index, account] of accounts.entries()) {
      setProgress(
        accounts.length > 1
          ? `Syncing ${account.name}… ${index + 1}/${accounts.length}`
          : `Syncing ${account.name}…`,
      );
      try {
        const response = await fetch("/api/ads/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            meta_ad_account_id: account.meta_ad_account_id,
            date_from: from,
            date_to: to,
            kind: "manual",
          }),
        });
        if (response.status === 409) {
          collected.push(`${account.name}: a sync is already running`);
        } else if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          collected.push(`${account.name}: ${body.error ?? `failed (${response.status})`}`);
        }
      } catch (err) {
        collected.push(`${account.name}: ${(err as Error).message}`);
      }
      // Refresh after each account so the status line ticks over as runs land.
      router.refresh();
    }

    setNotes(collected);
    setProgress(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={syncAll}
        disabled={busy || anyRunning || accounts.length === 0}
        className="h-9 text-xs"
      >
        <RefreshCw
          size={14}
          aria-hidden="true"
          className={busy || anyRunning ? "animate-spin" : undefined}
        />
        {progress ?? (anyRunning ? "Sync in progress" : "Sync now")}
      </Button>
      {notes.map((note) => (
        <p key={note} className="text-xs text-danger-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

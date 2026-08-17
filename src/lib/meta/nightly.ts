/**
 * Nightly orchestration: every active ad account, sequentially, over the
 * trailing 28-day IST window.
 *
 * 28 days, not the spec's 7: Meta's stated mutation horizon for insights is
 * 28 days, the cost difference is a call or two per account, and it
 * future-proofs conversion fields (see the Slice C design doc).
 *
 * One account's failure logs its 'failed' run and moves on — a rate-limit
 * block on one client must not cost the other clients their night.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAdAccountSync, type SyncAccount, type SyncDeps } from "@/lib/meta/sync";

export const NIGHTLY_WINDOW_DAYS = 28;
export const NIGHTLY_THUMBNAIL_CAP = 150;

/** YYYY-MM-DD for the Asia/Kolkata calendar day `offset` days from today. */
export function istDay(offset: number): string {
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  // Noon UTC dodges every DST/underflow edge when adding day offsets.
  const base = new Date(`${todayIst}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

/**
 * Trailing window ending TODAY IST: [today - days, today], inclusive.
 *
 * It ended yesterday until 2026-08-17, on the reasoning that a day still in
 * progress is not a real day. That was wrong against the way the KPIs window:
 * the preset path in `ads_summary` sets from_day and leaves to_day NULL, so
 * revenue and sessions include today while spend structurally could not. Every
 * ROAS was inflated and every CPA understated by one day's spend, silently and
 * on the default view. It surfaced as Love School reading ₹1,49,844 against Ads
 * Manager's ~₹1,54,000, with no amount of clicking Sync now able to close the
 * gap — the button takes its window from here too.
 *
 * Today's row is therefore partial by design, exactly as Ads Manager's own
 * figure is, and every later run inside the trailing horizon corrects it.
 *
 * `from` stays at today - days rather than shrinking to keep the span at 28:
 * the trailing window exists to absorb Meta's restatements over its 28-day
 * mutation horizon, and moving `from` forward would drop the oldest restatable
 * day to buy nothing. One more day of rows costs no extra API call — the
 * insights read is already paged.
 */
export function nightlyWindow(days: number = NIGHTLY_WINDOW_DAYS): { from: string; to: string } {
  return { from: istDay(-days), to: istDay(0) };
}

/** Active, non-fixture accounts eligible for the nightly run. */
export async function loadActiveAccounts(db: SupabaseClient): Promise<SyncAccount[]> {
  const { data, error } = await db
    .from("ad_accounts")
    .select("id, client_id, meta_ad_account_id, currency")
    .eq("status", "active")
    // Test fixtures (act_test_*) live in the same live table; they must never
    // reach a production sync loop.
    .not("meta_ad_account_id", "like", "act_test_%");
  if (error) throw new Error(`could not load active ad accounts: ${error.message}`);
  return (data ?? []) as SyncAccount[];
}

export type NightlyAccountOutcome = {
  meta_ad_account_id: string;
  outcome: "success" | "partial" | "conflict" | "failed";
  detail?: string;
};

export async function runNightlyForAccounts(
  deps: SyncDeps,
  accounts: SyncAccount[],
  window: { from: string; to: string } = nightlyWindow()
): Promise<NightlyAccountOutcome[]> {
  const outcomes: NightlyAccountOutcome[] = [];
  for (const account of accounts) {
    try {
      const result = await runAdAccountSync(deps, account, window.from, window.to, "nightly");
      if (result.conflict) {
        outcomes.push({
          meta_ad_account_id: account.meta_ad_account_id,
          outcome: "conflict",
          detail: `run ${result.runningRunId} already in progress`,
        });
      } else {
        outcomes.push({
          meta_ad_account_id: account.meta_ad_account_id,
          outcome: result.status,
          detail: `${result.rowsUpserted} rows, ${result.adsSynced} ads, ${result.thumbnailsMirrored} thumbnails`,
        });
      }
    } catch (err) {
      // The engine has already closed its run row as 'failed'.
      outcomes.push({
        meta_ad_account_id: account.meta_ad_account_id,
        outcome: "failed",
        detail: (err as Error).message,
      });
    }
  }
  return outcomes;
}

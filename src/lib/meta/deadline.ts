/**
 * Wall-clock budget for a sync invocation.
 *
 * Vercel kills a function at maxDuration with no cleanup hook, and the Meta
 * client's rate-limit handling can legally sleep for minutes (a score block is
 * 300s). The combination is what orphaned 'running' rows in ad_sync_runs: the
 * process died mid-sleep and the catch that closes the row never ran. The fix
 * is to know the deadline up front and refuse to start any sleep or phase that
 * cannot finish inside it — aborting with DeadlineError lets the sync close
 * its own run row honestly and the next cron re-run resume idempotently.
 */

export class DeadlineError extends Error {
  constructor(message = "deadline: invocation budget exhausted before the run finished") {
    super(message);
    this.name = "DeadlineError";
  }
}

/**
 * Subtracted from maxDuration so the sync always has time to close its run
 * row and return a response before the platform kill.
 */
export const DEADLINE_SAFETY_MS = 20_000;

/** Epoch-ms deadline for an invocation given its route maxDuration seconds. */
export function invocationDeadline(maxDurationSeconds: number, now = Date.now()): number {
  return now + maxDurationSeconds * 1000 - DEADLINE_SAFETY_MS;
}

/**
 * Throws DeadlineError if `upcomingMs` of work (a sleep, a phase) would pass
 * the deadline. No-op when no deadline is set, so every caller stays optional.
 */
export function assertBudget(deadlineAt: number | undefined, upcomingMs = 0): void {
  if (deadlineAt == null) return;
  if (Date.now() + upcomingMs > deadlineAt) {
    throw new DeadlineError(
      "deadline: invocation budget exhausted; data written so far is kept and the next run resumes idempotently"
    );
  }
}

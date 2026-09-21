"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { voidManualPayment, type VoidState } from "@/app/(dashboard)/customers/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The only correction for a hand-recorded payment: void it, with a reason.
 * The row stays (struck through in the timeline, out of every number); a
 * mistake is fixed by voiding and recording again. Admin-only — RLS makes a
 * client user's attempt match nothing, and the button is not shown to them.
 */
export function VoidPaymentForm({ paymentId }: { paymentId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<VoidState, FormData>(voidManualPayment, {});

  if (state.ok) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-slate-500 underline-offset-2 hover:text-danger-foreground hover:underline"
      >
        Void
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={paymentId} />
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor={id} className="block text-[11px] text-slate-400">
          Why is this being voided?
        </label>
        <input
          id={id}
          name="reason"
          required
          maxLength={300}
          autoFocus
          placeholder="e.g. entered twice"
          disabled={pending}
          className={cn(
            "w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none",
          )}
        />
        {state.error && <p className="text-[11px] text-danger-foreground">{state.error}</p>}
      </div>
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Keep
      </Button>
      <Button type="submit" size="xs" variant="destructive" disabled={pending}>
        {pending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
        {pending ? "Voiding…" : "Void payment"}
      </Button>
    </form>
  );
}

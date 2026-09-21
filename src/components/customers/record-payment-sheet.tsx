"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, Loader2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  recordManualPayment,
  searchCustomers,
  type RecordState,
} from "@/app/(dashboard)/customers/actions";
import { CONTROL, CustomerCombobox, type CustomerPick } from "@/components/customers/customer-combobox";
import { Button } from "@/components/ui/button";
import { formatDayShort, formatINR } from "@/lib/format";
import { paymentOrigin } from "@/lib/payment-origin";
import { PAYMENT_METHODS, referenceHintFor, type PaymentMethodSlug } from "@/lib/payments/methods";
import {
  flattenFieldErrors,
  recordSchemaFor,
  type FieldErrors,
  type RecordField,
} from "@/lib/payments/record-schema";
import type { CustomerHit } from "@/lib/queries/manual-payments";
import { cn } from "@/lib/utils";

/**
 * Record an off-platform payment — GPay, bank transfer, cash — against a
 * customer, without raw SQL. Opened by `?record=1` (blank) or
 * `?record=<customer_id>` (prefilled from that person's sheet); a
 * right-anchored Dialog exactly like CustomerSheet, so the two never stack:
 * closing restores `?customer=` when it came from there.
 *
 * Validation runs on submit (GOV.UK: never on blur), with an error summary
 * that takes focus and per-field messages; the server re-runs the same zod
 * schema and the database re-checks everything again. Sticky fields (date,
 * amount, method, product) are controlled state because React resets
 * uncontrolled inputs after a successful action — "Record another" keeps
 * them and mints a fresh idempotency key.
 *
 * Three outcomes come back from the action besides errors: recorded,
 * possible duplicate (the "Ritu case" — shown with the matching row and a
 * "Record anyway"), and a conflict where email and phone name two different
 * people (choose one; never merged here).
 */

const FIELD_LABEL: Record<RecordField, string> = {
  customerMode: "Customer",
  customerId: "Customer",
  newName: "Name",
  newEmail: "Email",
  newPhone: "Phone",
  amount: "Amount",
  paidDay: "Date received",
  method: "Method",
  reference: "Reference",
  productName: "Product",
  note: "Note",
  idempotencyKey: "Submission",
  confirmDuplicate: "Duplicate",
};

type Sticky = {
  amount: string;
  paidDay: string;
  method: PaymentMethodSlug;
  productName: string;
};

export function RecordPaymentSheet({
  clientName,
  today,
  defaultProduct,
  prefill,
  returnToCustomerId,
}: {
  clientName: string;
  today: string;
  defaultProduct: string;
  prefill: CustomerHit | null;
  /** Set when opened from a customer's sheet — Done goes back there. */
  returnToCustomerId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();

  const [state, action, pending] = useActionState<RecordState, FormData>(
    recordManualPayment,
    {},
  );
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pick, setPick] = useState<CustomerPick>({ mode: "existing", customer: prefill });
  const [sticky, setSticky] = useState<Sticky>({
    amount: "",
    paidDay: today,
    method: "gpay",
    productName: defaultProduct,
  });
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // State from an older submission (a previous key) is stale — ignore it.
  const current = state.key === key ? state : {};
  const errors: FieldErrors = { ...current.fieldErrors, ...clientErrors };
  const hasErrors = Object.keys(errors).length > 0 || current.error != null;

  useEffect(() => {
    if (hasErrors) summaryRef.current?.focus();
  }, [hasErrors, current.error, current.fieldErrors, clientErrors]);

  // "Record anyway": resubmit the SAME key once the confirm flag is in the
  // DOM — the RPC then records it, marked confirmed_duplicate.
  useEffect(() => {
    if (confirmDuplicate) formRef.current?.requestSubmit();
  }, [confirmDuplicate]);

  function close(next?: URLSearchParams) {
    const sp = next ?? new URLSearchParams(params.toString());
    sp.delete("record");
    if (returnToCustomerId) sp.set("customer", returnToCustomerId);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  /** A fresh key makes any returned state stale, i.e. dismisses it. */
  function dismissOutcome() {
    setKey(crypto.randomUUID());
    setConfirmDuplicate(false);
  }

  function recordAnother() {
    dismissOutcome();
    setPick({ mode: "existing", customer: null });
    setReference("");
    setNote("");
    setClientErrors({});
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Same schema as the server; a failure here saves a round trip and keeps
    // every typed value in place. The server decides regardless.
    const raw = Object.fromEntries(
      Array.from(new FormData(e.currentTarget).entries()).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const parsed = recordSchemaFor(today).safeParse(raw);
    if (!parsed.success) {
      e.preventDefault();
      setClientErrors(flattenFieldErrors(parsed.error));
      return;
    }
    setClientErrors({});
  }

  const recorded = current.recorded;
  const duplicate = current.duplicate;
  const conflict = current.conflict;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-white/10 bg-popover p-6 text-popover-foreground outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-white">
                Record payment
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-slate-400">
                {clientName} · a payment made outside Trace&apos;s checkout
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-white/5 text-slate-400 transition-colors hover:text-white"
            >
              <X size={14} aria-hidden="true" />
            </Dialog.Close>
          </div>

          {recorded ? (
            <RecordedPanel
              recorded={recorded}
              onDone={() => close()}
              onAnother={recordAnother}
            />
          ) : (
            <form
              ref={formRef}
              action={action}
              onSubmit={onSubmit}
              noValidate
              className="mt-6 space-y-5"
            >
              <input type="hidden" name="idempotencyKey" value={key} />
              <input type="hidden" name="confirmDuplicate" value={confirmDuplicate ? "1" : ""} />

              {hasErrors && (
                <div
                  ref={summaryRef}
                  tabIndex={-1}
                  role="alert"
                  className="rounded-lg border border-danger-foreground/30 bg-danger px-3 py-2 text-xs text-danger-foreground outline-none"
                >
                  <p className="font-medium">
                    {current.error ?? "Fix the following to record this payment"}
                  </p>
                  {Object.keys(errors).length > 0 && (
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {(Object.entries(errors) as [RecordField, string][]).map(([f, msg]) => (
                        <li key={f}>
                          <a href={`#${id}-${f}`} className="underline underline-offset-2">
                            {FIELD_LABEL[f]}
                          </a>
                          : {msg}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {duplicate && !confirmDuplicate && (
                <DuplicatePanel
                  match={duplicate}
                  onConfirm={() => setConfirmDuplicate(true)}
                  onCancel={dismissOutcome}
                />
              )}

              {conflict && (
                <ConflictPanel
                  conflict={conflict}
                  onUse={(c) => setPick({ mode: "existing", customer: c })}
                />
              )}

              <CustomerCombobox
                value={pick}
                onChange={setPick}
                search={searchCustomers}
                errors={errors}
                disabled={pending}
              />

              <Field id={`${id}-amount`} label="Amount" error={errors.amount}>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500"
                  >
                    ₹
                  </span>
                  <input
                    id={`${id}-amount`}
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="9724.20"
                    value={sticky.amount}
                    onChange={(e) => setSticky({ ...sticky, amount: e.target.value })}
                    disabled={pending}
                    aria-invalid={errors.amount ? true : undefined}
                    className={cn(CONTROL, "pl-7 tabular-nums", errors.amount && "border-danger-foreground/60")}
                  />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field id={`${id}-paidDay`} label="Date received" error={errors.paidDay}>
                  <input
                    id={`${id}-paidDay`}
                    name="paidDay"
                    type="date"
                    max={today}
                    value={sticky.paidDay}
                    onChange={(e) => setSticky({ ...sticky, paidDay: e.target.value })}
                    disabled={pending}
                    aria-invalid={errors.paidDay ? true : undefined}
                    className={cn(CONTROL, "scheme-dark", errors.paidDay && "border-danger-foreground/60")}
                  />
                </Field>
                <Field id={`${id}-method`} label="Method" error={errors.method}>
                  <select
                    id={`${id}-method`}
                    name="method"
                    value={sticky.method}
                    onChange={(e) =>
                      setSticky({ ...sticky, method: e.target.value as PaymentMethodSlug })
                    }
                    disabled={pending}
                    className={cn(CONTROL, "scheme-dark")}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.slug} value={m.slug}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                id={`${id}-reference`}
                label="Reference"
                hint={referenceHintFor(sticky.method)}
                error={errors.reference}
              >
                <input
                  id={`${id}-reference`}
                  name="reference"
                  type="text"
                  autoComplete="off"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  disabled={pending}
                  className={cn(CONTROL, errors.reference && "border-danger-foreground/60")}
                />
              </Field>

              <Field id={`${id}-productName`} label="Product" error={errors.productName}>
                <input
                  id={`${id}-productName`}
                  name="productName"
                  type="text"
                  autoComplete="off"
                  value={sticky.productName}
                  onChange={(e) => setSticky({ ...sticky, productName: e.target.value })}
                  disabled={pending}
                  className={cn(CONTROL, errors.productName && "border-danger-foreground/60")}
                />
              </Field>

              <Field
                id={`${id}-note`}
                label="Note"
                hint="Optional — anything the coach should remember about this one."
                error={errors.note}
              >
                <textarea
                  id={`${id}-note`}
                  name="note"
                  rows={2}
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={pending}
                  className={cn(CONTROL, "resize-none", errors.note && "border-danger-foreground/60")}
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => close()} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      Saving…
                    </>
                  ) : (
                    "Record payment"
                  )}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-300">
        {label}
      </label>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {children}
      {error && <p className="text-xs text-danger-foreground">{error}</p>}
    </div>
  );
}

function RecordedPanel({
  recorded,
  onDone,
  onAnother,
}: {
  recorded: NonNullable<RecordState["recorded"]>;
  onDone: () => void;
  onAnother: () => void;
}) {
  return (
    <div className="mt-6 space-y-5" aria-live="polite">
      <div className="rounded-xl border border-success-foreground/30 bg-success p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-success-foreground">
          <Check size={14} aria-hidden="true" />
          Payment recorded
        </p>
        <p className="mt-1 font-heading text-2xl font-bold tracking-tight text-white tabular-nums">
          {formatINR(recorded.amountPaise)}
          <span className="ml-2 text-sm font-normal text-slate-400">
            from {recorded.customerName || "Unnamed customer"}
          </span>
        </p>
        {recorded.createdCustomer && (
          <p className="mt-1 text-xs text-slate-400">
            Added as a new customer. With no Trace checkout purchase they count as
            Unattributed — no ad gets the credit.
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
        <Button onClick={onAnother}>Record another</Button>
      </div>
    </div>
  );
}

function DuplicatePanel({
  match,
  onConfirm,
  onCancel,
}: {
  match: NonNullable<RecordState["duplicate"]>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const origin = paymentOrigin({
    external: true,
    source: match.source,
    method: match.payment_method,
  });
  const day = new Date(match.paid_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-warning-foreground/30 bg-warning p-4 text-xs text-warning-foreground"
    >
      <p className="text-sm font-medium">Possible duplicate</p>
      <p className="text-slate-300">
        {match.customer_name || "This customer"} already has a payment of{" "}
        <span className="font-medium text-white tabular-nums">{formatINR(match.amount_paise)}</span>{" "}
        on {formatDayShort(day)} — <span className="text-white">{origin.label}</span>
        {match.product_name ? ` · ${match.product_name}` : ""}. A GPay payment made through
        a payment link is often already here from the Razorpay sync.
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onConfirm}>
          Record anyway
        </Button>
      </div>
    </div>
  );
}

function ConflictPanel({
  conflict,
  onUse,
}: {
  conflict: NonNullable<RecordState["conflict"]>;
  onUse: (c: CustomerHit) => void;
}) {
  const row = (c: CustomerHit, key: "email" | "phone") => (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm text-white">{c.name || "Unnamed customer"}</span>
        <span className="block truncate text-[11px] text-slate-500">
          matches the {key} · {[c.email_norm, c.phone_norm].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Button type="button" size="sm" variant="outline" onClick={() => onUse(c)}>
        Use
      </Button>
    </div>
  );
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-warning-foreground/30 bg-warning p-4 text-xs">
      <p className="text-sm font-medium text-warning-foreground">Two customers match</p>
      <p className="text-slate-300">
        The email and phone belong to different people. Pick the one who paid; nothing has
        been recorded yet.
      </p>
      {row(conflict.emailCustomer, "email")}
      {row(conflict.phoneCustomer, "phone")}
    </div>
  );
}

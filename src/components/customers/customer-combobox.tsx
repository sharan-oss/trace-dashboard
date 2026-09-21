"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, Plus, UserRound } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import type { CustomerHit } from "@/lib/queries/manual-payments";
import { normalizeEmail, normalizePhone } from "@/lib/payments/normalize";
import type { FieldErrors } from "@/lib/payments/record-schema";
import { cn } from "@/lib/utils";

/**
 * "Who paid?" — the one field that decides whether a hand-recorded payment
 * lands on the right person. Async search over name, email and phone across
 * the WHOLE customer list (Base UI Combobox, "async search" pattern), with a
 * "Create …" row when nothing matches. Creating reveals name/email/phone and
 * warns when a key already belongs to someone — Stripe's own advice, since
 * merging customers later is the expensive cure.
 *
 * Controlled: the sheet owns the picked value so its conflict panel can say
 * "Use X" and have the field follow. Emits hidden inputs for the action.
 */

export type CustomerPick =
  | { mode: "existing"; customer: CustomerHit | null }
  | { mode: "new"; name: string; email: string; phone: string };

type CreateRow = { kind: "create"; query: string };
type Row = CustomerHit | CreateRow;

const isCreate = (row: Row): row is CreateRow => "kind" in row && row.kind === "create";

export const CONTROL =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none";

function suggestName(query: string): string {
  const q = query.trim();
  if (q.includes("@") || /\d{4,}/.test(q)) return "";
  return q;
}

export function CustomerCombobox({
  value,
  onChange,
  search,
  errors,
  disabled,
}: {
  value: CustomerPick;
  onChange: (next: CustomerPick) => void;
  search: (q: string) => Promise<CustomerHit[]>;
  errors: FieldErrors;
  disabled?: boolean;
}) {
  const id = useId();
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);

  const selected = value.mode === "existing" ? value.customer : null;
  const trimmed = query.trim();

  const items = useMemo<Row[]>(() => {
    const base: Row[] = [...results];
    if (selected && !results.some((r) => r.id === selected.id)) base.push(selected);
    const exact = results.some(
      (r) =>
        r.name.toLowerCase() === trimmed.toLowerCase() ||
        r.email_norm === trimmed.toLowerCase(),
    );
    if (trimmed.length > 0 && !pending && !exact) base.push({ kind: "create", query: trimmed });
    return base;
  }, [results, selected, trimmed, pending]);

  function runSearch(q: string) {
    const mine = ++seq.current;
    startTransition(async () => {
      const hits = await search(q);
      if (mine !== seq.current) return; // a newer keystroke already answered
      startTransition(() => setResults(hits));
    });
  }

  if (value.mode === "new") {
    return (
      <NewCustomerFields
        value={value}
        onChange={onChange}
        onUseExisting={(c) => onChange({ mode: "existing", customer: c })}
        search={search}
        errors={errors}
        disabled={disabled}
      />
    );
  }

  const status = pending
    ? "Searching…"
    : trimmed === ""
      ? selected
        ? null
        : "Type a name, email or phone"
      : results.length === 0
        ? `No one matches "${trimmed}"`
        : null;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-300">
        Customer
      </label>
      <input type="hidden" name="customerMode" value="existing" />
      <input type="hidden" name="customerId" value={selected?.id ?? ""} />
      <Combobox.Root<Row>
        items={items}
        value={selected}
        filter={null}
        autoHighlight
        disabled={disabled}
        itemToStringLabel={(row) => (isCreate(row) ? row.query : row.name)}
        isItemEqualToValue={(a, b) => !isCreate(a) && !isCreate(b) && a.id === b.id}
        onValueChange={(row) => {
          if (row == null) {
            onChange({ mode: "existing", customer: null });
            return;
          }
          if (isCreate(row)) {
            const q = row.query;
            onChange({
              mode: "new",
              name: suggestName(q),
              email: q.includes("@") ? q : "",
              phone: /^\+?[\d\s()-]{10,}$/.test(q) ? q : "",
            });
            return;
          }
          onChange({ mode: "existing", customer: row });
          setQuery("");
        }}
        onInputValueChange={(next, { reason }) => {
          setQuery(next);
          if (reason === "item-press") return;
          if (next.trim() === "") {
            seq.current++;
            setResults([]);
            return;
          }
          runSearch(next);
        }}
      >
        <Combobox.InputGroup className="relative">
          <Combobox.Input
            id={id}
            placeholder="Search name, email or phone…"
            autoComplete="off"
            aria-invalid={errors.customerId ? true : undefined}
            aria-describedby={errors.customerId ? `${id}-error` : undefined}
            className={cn(CONTROL, errors.customerId && "border-danger-foreground/60")}
          />
          {selected && (
            <Combobox.Clear
              aria-label="Clear customer"
              className="absolute inset-y-0 right-2 my-auto grid size-6 place-items-center rounded text-slate-500 hover:text-white"
            >
              ×
            </Combobox.Clear>
          )}
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner className="z-[60] outline-none" sideOffset={4}>
            <Combobox.Popup
              aria-busy={pending || undefined}
              className="w-[var(--anchor-width)] max-w-[var(--available-width)] rounded-lg border border-white/10 bg-popover p-1 text-popover-foreground"
            >
              <div className="max-h-[min(var(--available-height),18rem)] overflow-y-auto overscroll-contain">
                <Combobox.Status>
                  {status && (
                    <div className="px-2 py-1.5 text-xs text-slate-500" aria-live="polite">
                      {status}
                    </div>
                  )}
                </Combobox.Status>
                <Combobox.List>
                  {(row: Row) =>
                    isCreate(row) ? (
                      <Combobox.Item
                        key="__create__"
                        value={row}
                        className="flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm text-indigo-300 outline-none select-none data-highlighted:bg-indigo-500/10"
                      >
                        <Plus size={14} aria-hidden="true" />
                        <span className="truncate">
                          Add <span className="font-medium">“{row.query}”</span> as a new customer
                        </span>
                      </Combobox.Item>
                    ) : (
                      <Combobox.Item
                        key={row.id}
                        value={row}
                        className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-white/5"
                      >
                        <Combobox.ItemIndicator className="text-indigo-300">
                          <Check size={12} aria-hidden="true" />
                        </Combobox.ItemIndicator>
                        <span className="col-start-2 min-w-0">
                          <span className="block truncate text-white">
                            {row.name || "Unnamed customer"}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {[row.email_norm, row.phone_norm].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Combobox.Item>
                    )
                  }
                </Combobox.List>
              </div>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {selected && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <UserRound size={11} aria-hidden="true" />
          <span className="truncate">
            {[selected.email_norm, selected.phone_norm].filter(Boolean).join(" · ") ||
              "No contact details on file"}
          </span>
        </p>
      )}
      {errors.customerId && (
        <p id={`${id}-error`} className="text-xs text-danger-foreground">
          {errors.customerId}
        </p>
      )}
    </div>
  );
}

function NewCustomerFields({
  value,
  onChange,
  onUseExisting,
  search,
  errors,
  disabled,
}: {
  value: Extract<CustomerPick, { mode: "new" }>;
  onChange: (next: CustomerPick) => void;
  onUseExisting: (c: CustomerHit) => void;
  search: (q: string) => Promise<CustomerHit[]>;
  errors: FieldErrors;
  disabled?: boolean;
}) {
  const id = useId();
  const [existing, setExisting] = useState<CustomerHit | null>(null);
  const emailNorm = normalizeEmail(value.email);
  const phoneNorm = normalizePhone(value.phone);

  // Warn before create, not after: a key that already belongs to someone
  // means this payment is theirs. Checked when a key is complete, debounced.
  useEffect(() => {
    if (emailNorm == null && phoneNorm == null) {
      setExisting(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const probes = [emailNorm, phoneNorm].filter((k): k is string => k != null);
      for (const probe of probes) {
        const hits = await search(probe);
        if (cancelled) return;
        const hit = hits.find((h) => h.email_norm === emailNorm || h.phone_norm === phoneNorm);
        if (hit) {
          setExisting(hit);
          return;
        }
      }
      if (!cancelled) setExisting(null);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [emailNorm, phoneNorm, search]);

  const field = (
    name: "newName" | "newEmail" | "newPhone",
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) => {
    const error = errors[name];
    return (
      <div className="space-y-1.5">
        <label htmlFor={`${id}-${name}`} className="block text-sm font-medium text-slate-300">
          {label}
        </label>
        <input
          id={`${id}-${name}`}
          name={name}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-${name}-error` : undefined}
          className={cn(CONTROL, error && "border-danger-foreground/60")}
          {...props}
        />
        {error && (
          <p id={`${id}-${name}-error`} className="text-xs text-danger-foreground">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-xl border border-indigo-500/30 bg-indigo-500/6 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-wider text-indigo-300 uppercase">
          New customer
        </p>
        <button
          type="button"
          onClick={() => onChange({ mode: "existing", customer: null })}
          className="text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline"
        >
          Pick an existing customer instead
        </button>
      </div>
      <input type="hidden" name="customerMode" value="new" />
      {field("newName", "Name", {
        value: value.name,
        onChange: (e) => onChange({ ...value, name: e.target.value }),
        placeholder: "e.g. Hetal Thakker",
        autoComplete: "off",
      })}
      {field("newEmail", "Email", {
        type: "email",
        inputMode: "email",
        value: value.email,
        onChange: (e) => onChange({ ...value, email: e.target.value }),
        placeholder: "name@example.com",
        autoComplete: "off",
      })}
      {field("newPhone", "Phone", {
        type: "tel",
        inputMode: "tel",
        value: value.phone,
        onChange: (e) => onChange({ ...value, phone: e.target.value }),
        placeholder: "10-digit mobile",
        autoComplete: "off",
      })}
      <p className="text-[11px] text-slate-500">
        Email or phone — at least one. This is how later payments find the same person.
      </p>
      {existing && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-foreground/30 bg-warning px-3 py-2 text-xs text-warning-foreground"
        >
          <span className="min-w-0">
            Looks like <span className="font-medium">{existing.name || "an existing customer"}</span>{" "}
            already has this {existing.email_norm === emailNorm ? "email" : "phone"}.
          </span>
          <button
            type="button"
            onClick={() => onUseExisting(existing)}
            className="rounded-md border border-warning-foreground/40 px-2 py-0.5 font-medium hover:bg-warning-foreground/10"
          >
            Use them
          </button>
        </div>
      )}
    </div>
  );
}

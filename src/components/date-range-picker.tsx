"use client";

import { Popover } from "@base-ui/react/popover";
import { Switch } from "@base-ui/react/switch";
import { CalendarDays, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatDayRange } from "@/lib/format";
import { RANGE_OPTIONS, type RangeState } from "@/lib/range";
import { cn } from "@/lib/utils";

/**
 * The dashboard's one date control. Three presets, plus a popover holding the
 * two things most clients never need: an explicit custom window, and — only
 * where L2 data exists — a separate window for upsell revenue.
 *
 * That split is what a webinar funnel needs: ads run 1-15, the webinar sells on
 * 15-16, and asking one range to describe both makes the campaign look either
 * unprofitable or impossibly good. Hidden behind a switch because most clients
 * do not run webinars and should never have to reason about it.
 *
 * State lives entirely in the URL so views stay shareable and back/forward
 * work. Only the range keys are ever touched — the Ads section's ?tab= and
 * ?campaign= must survive every interaction here.
 */
export function DateRangePicker({
  state,
  showCustom = false,
  showL2Toggle = false,
}: {
  state: RangeState;
  /**
   * False renders presets only — the form Customers and Funnel use, whose
   * reads take a preset. Offering a custom window there would let the user set
   * one those pages then ignore.
   */
  showCustom?: boolean;
  /** False hides the split control entirely: no L2 rows means it could only read zero. */
  showL2Toggle?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const custom = state.l1.kind === "custom" ? state.l1 : null;

  /** Rewrites only the range keys; every other param is carried through. */
  function commit(next: {
    range: string;
    from?: string;
    to?: string;
    l2?: { from: string; to: string } | null;
  }) {
    const params = new URLSearchParams(searchParams);
    params.set("range", next.range);
    for (const key of ["from", "to"] as const) {
      const value = next[key];
      if (value == null) params.delete(key);
      else params.set(key, value);
    }
    // `undefined` means "leave the L2 window as it is" — switching preset
    // should not silently discard a webinar window the user set up.
    if (next.l2 !== undefined) {
      if (next.l2 == null) {
        params.delete("l2from");
        params.delete("l2to");
      } else {
        params.set("l2from", next.l2.from);
        params.set("l2to", next.l2.to);
      }
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Date range"
        className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-white/5 p-0.5"
      >
        {RANGE_OPTIONS.map((option) => {
          const active = custom == null && state.l1.kind === "preset" && option.value === state.l1.preset;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => commit({ range: option.value })}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {option.label}
            </button>
          );
        })}

        {showCustom && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            render={
              <button
                type="button"
                aria-label="Custom date range"
                aria-pressed={custom != null}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                  custom != null
                    ? "bg-accent text-accent-foreground"
                    : "text-slate-400 hover:text-white",
                )}
              >
                <CalendarDays size={14} aria-hidden />
                {custom != null ? formatDayRange(custom.from, custom.to) : "Custom"}
              </button>
            }
          />
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={8}>
              <Popover.Popup className="z-50 w-76 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-none outline-none">
                <WindowForm
                  state={state}
                  showL2Toggle={showL2Toggle}
                  onApply={(next) => {
                    commit(next);
                    setOpen(false);
                  }}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        )}
      </div>

      {state.l2 != null && (
        <span className="inline-flex items-center gap-2 rounded-lg border border-indigo-400/25 bg-indigo-400/10 py-1 pr-1 pl-2.5 text-xs text-indigo-200">
          <span className="whitespace-nowrap">
            L1 {custom != null ? formatDayRange(custom.from, custom.to) : rangeLabel(state)} · L2{" "}
            {formatDayRange(state.l2.from, state.l2.to)}
          </span>
          <button
            type="button"
            aria-label="Clear separate L2 window"
            onClick={() => commit({ range: rangeParam(state), ...customParams(custom), l2: null })}
            className="rounded p-0.5 text-indigo-300/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      )}
    </div>
  );
}

function rangeParam(state: RangeState): string {
  return state.l1.kind === "custom" ? "custom" : state.l1.preset;
}

function rangeLabel(state: RangeState): string {
  const l1 = state.l1;
  if (l1.kind === "custom") return formatDayRange(l1.from, l1.to);
  return RANGE_OPTIONS.find((o) => o.value === l1.preset)?.label ?? "";
}

function customParams(custom: { from: string; to: string } | null) {
  return custom == null ? {} : { from: custom.from, to: custom.to };
}

/**
 * The popover body. Draft values are local until Apply so a half-typed date
 * never re-runs the page's queries — a date input emits a value on every
 * keystroke, and "2026-08-0" is a window nobody asked for.
 */
function WindowForm({
  state,
  showL2Toggle,
  onApply,
}: {
  state: RangeState;
  showL2Toggle: boolean;
  onApply: (next: {
    range: string;
    from?: string;
    to?: string;
    l2?: { from: string; to: string } | null;
  }) => void;
}) {
  const custom = state.l1.kind === "custom" ? state.l1 : null;
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");
  const [split, setSplit] = useState(state.l2 != null);
  const [l2From, setL2From] = useState(state.l2?.from ?? "");
  const [l2To, setL2To] = useState(state.l2?.to ?? "");

  const l1Valid = from !== "" && to !== "" && from <= to;
  const l2Valid = l2From !== "" && l2To !== "" && l2From <= l2To;
  const canApply = l1Valid && (!split || l2Valid);

  return (
    <div className="space-y-4">
      <Field label="Date range" hint={l1Valid || from === "" || to === "" ? null : "End date is before the start date"}>
        <DayPair from={from} to={to} onFrom={setFrom} onTo={setTo} idPrefix="l1" />
      </Field>

      {showL2Toggle && (
        <div className="space-y-3 border-t border-border pt-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-200">Separate L2 window</span>
            <Switch.Root
              checked={split}
              onCheckedChange={setSplit}
              className={cn(
                "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors outline-none",
                split ? "bg-indigo-500" : "bg-white/10",
              )}
            >
              <Switch.Thumb className="block h-4 w-4 rounded-full bg-white transition-transform data-checked:translate-x-4" />
            </Switch.Root>
          </label>

          {split ? (
            <>
              <DayPair
                from={l2From}
                to={l2To}
                onFrom={setL2From}
                onTo={setL2To}
                idPrefix="l2"
              />
              <p className="text-[11px] leading-relaxed text-slate-500">
                Counts upsell payments made in this window by customers acquired in the
                main range — so a webinar&apos;s revenue is credited to the ads that
                filled it, not to whoever happened to buy that week.
              </p>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-500">
              For webinar funnels: ads run one week, the webinar sells the next.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onApply({ range: "30d", l2: null })}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
        >
          Reset
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={() =>
            onApply({
              range: "custom",
              from,
              to,
              l2: split ? { from: l2From, to: l2To } : null,
            })
          }
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            canApply
              ? "bg-indigo-500 text-white hover:bg-indigo-400"
              : "cursor-not-allowed bg-white/5 text-slate-600",
          )}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-slate-200">{label}</span>
      {children}
      {hint != null && <p className="text-[11px] text-red-400">{hint}</p>}
    </div>
  );
}

/** Native date inputs: no dependency, keyboard and screen-reader support for
 * free, and they emit exactly the YYYY-MM-DD the RPCs take. */
function DayPair({
  from,
  to,
  onFrom,
  onTo,
  idPrefix,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <input
        type="date"
        aria-label={`${idPrefix === "l2" ? "L2 window" : "Range"} start`}
        value={from}
        max={to === "" ? undefined : to}
        onChange={(e) => onFrom(e.target.value)}
        className="w-full rounded-md border border-border bg-white/5 px-2 py-1.5 text-xs text-slate-100 scheme-dark outline-none focus:border-indigo-400/60"
      />
      <input
        type="date"
        aria-label={`${idPrefix === "l2" ? "L2 window" : "Range"} end`}
        value={to}
        min={from === "" ? undefined : from}
        onChange={(e) => onTo(e.target.value)}
        className="w-full rounded-md border border-border bg-white/5 px-2 py-1.5 text-xs text-slate-100 scheme-dark outline-none focus:border-indigo-400/60"
      />
    </div>
  );
}

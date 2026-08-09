"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { selectClient } from "@/app/(dashboard)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClientRow } from "@/lib/queries/overview";
import { cn } from "@/lib/utils";

/**
 * The sidebar's client dropdown — Meta ad-account-picker style: overline
 * label, name over a mono id subtitle, check on the active row. Selecting
 * writes the cookie via a server action; every page re-resolves it against
 * the caller's RLS-visible list.
 */
export function ClientSwitcher({
  clients,
  selectedId,
}: {
  clients: ClientRow[];
  selectedId: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const selected = clients.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-xs font-semibold tracking-wider text-slate-400 uppercase">
        Client
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-white/5 px-3 py-2 text-left text-sm font-medium text-white transition-colors hover:bg-white/8 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:outline-none",
            isPending && "opacity-60",
          )}
          disabled={clients.length === 0}
        >
          <span className="truncate">{selected?.name ?? "No clients"}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-slate-500" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {clients.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => startTransition(() => selectClient(c.id))}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-slate-300">
                  {c.name}
                </span>
                <span className="truncate font-mono text-xs text-slate-500">
                  {c.id}
                </span>
              </span>
              {c.id === selectedId && (
                <Check
                  size={15}
                  className="ml-auto shrink-0 text-accent-foreground"
                />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

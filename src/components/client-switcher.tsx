"use client";

import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { selectClient } from "@/app/actions";
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
      <p className="px-2 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Client
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-transparent px-2.5 py-2 text-left text-sm font-medium transition-opacity",
            isPending && "opacity-60",
          )}
          disabled={clients.length === 0}
        >
          <span className="truncate">{selected?.name ?? "No clients"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {clients.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => startTransition(() => selectClient(c.id))}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{c.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {c.id}
                </span>
              </span>
              {c.id === selectedId && (
                <Check className="ml-auto size-4 shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

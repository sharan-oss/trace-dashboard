import type * as React from "react";
import { cookies } from "next/headers";
import type { Identity } from "@/lib/auth/session";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { getClients } from "@/lib/queries/overview";
import { createServerClient } from "@/lib/supabase/server";
import { AccountMenu } from "@/components/account-menu";
import { ClientSwitcher } from "@/components/client-switcher";
import { SidebarNav } from "@/components/sidebar-nav";

/**
 * The app frame every route renders inside: left sidebar (nav + client
 * switcher + account menu) on desktop, a stacked top bar below `sm`. Fetches
 * the RLS-scoped client list itself so the switcher only ever offers what the
 * caller may see.
 */
export async function AppShell({
  identity,
  children,
}: {
  identity: Identity;
  children: React.ReactNode;
}) {
  // cookies() first: it opts the route out of static prerendering before any
  // network call, so builds never fetch live data with a build-time JWT.
  const cookieStore = await cookies();
  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const selected = resolveSelectedClient(
    clients,
    cookieStore.get(CLIENT_COOKIE)?.value,
  );

  // A client user's RLS-visible list is their own account and nothing else —
  // a picker with one entry is noise, so it only appears when there is a
  // genuine choice to make.
  const showSwitcher = clients.length > 1;

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-sidebar-border bg-sidebar p-6 text-sidebar-foreground sm:sticky sm:top-0 sm:h-screen sm:w-60 sm:border-b-0 sm:border-r">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-white">
            Trace
          </span>
          <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-500">
            dashboard
          </span>
        </div>
        <SidebarNav isAdmin={identity.isAdmin} />
        <div className="flex flex-col gap-4 sm:mt-auto">
          {showSwitcher ? (
            <ClientSwitcher clients={clients} selectedId={selected?.id ?? null} />
          ) : (
            selected && (
              <div className="flex flex-col gap-1.5">
                <p className="px-1 text-xs font-semibold tracking-wider text-slate-400 uppercase">
                  Client
                </p>
                <p className="truncate px-1 text-sm font-medium text-white">
                  {selected.name}
                </p>
              </div>
            )
          )}
          <AccountMenu identity={identity} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

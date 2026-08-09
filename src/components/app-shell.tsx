import type * as React from "react";
import { cookies } from "next/headers";
import { CLIENT_COOKIE, resolveSelectedClient } from "@/lib/client-selection";
import { getClients } from "@/lib/queries/overview";
import { createServerClient } from "@/lib/supabase/server";
import { ClientSwitcher } from "@/components/client-switcher";
import { SidebarNav } from "@/components/sidebar-nav";

/**
 * The app frame every route renders inside: left sidebar (nav + client
 * switcher) on desktop, a stacked top bar below `sm`. Fetches the RLS-scoped
 * client list itself so the switcher only ever offers what the caller may
 * see.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  // cookies() first: it opts the route out of static prerendering before any
  // network call, so builds never fetch live data with a build-time JWT.
  const cookieStore = await cookies();
  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const selected = resolveSelectedClient(
    clients,
    cookieStore.get(CLIENT_COOKIE)?.value,
  );

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
        <SidebarNav />
        <div className="sm:mt-auto">
          <ClientSwitcher clients={clients} selectedId={selected?.id ?? null} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

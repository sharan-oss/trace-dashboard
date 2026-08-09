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
      <aside className="flex shrink-0 flex-col gap-4 border-b border-sidebar-border bg-sidebar p-4 text-sidebar-foreground sm:sticky sm:top-0 sm:h-screen sm:w-60 sm:border-b-0 sm:border-r">
        <div className="px-2 font-heading text-lg font-semibold tracking-tight">
          Trace
        </div>
        <SidebarNav />
        <div className="sm:mt-auto">
          <ClientSwitcher clients={clients} selectedId={selected?.id ?? null} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
    </div>
  );
}

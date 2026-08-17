import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getIdentity } from "@/lib/auth/session";
import { getClients } from "@/lib/queries/overview";
import { createServerClient } from "@/lib/supabase/server";
import { AddUserForm } from "./add-user-form";
import { removeUser } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Who can sign in. The table is a plain RLS-scoped read of app_users, so the
 * permission matrix applies itself: a super admin gets every row back, a team
 * member only the rows they added, and the same predicate governs delete. No
 * filtering happens here.
 *
 * Team members aren't listed because they have no rows — an @alttredmiinds.com
 * mailbox is the membership, and Google Workspace is where it's revoked.
 */

const ADDED = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

type AppUser = {
  id: string;
  email: string;
  role: "super_admin" | "client";
  client_id: string | null;
  invited_by: string;
  created_at: string;
};

export default async function UsersPage() {
  const identity = await getIdentity();
  if (!identity?.isAdmin) redirect("/");

  const supabase = await createServerClient();
  const clients = await getClients(supabase);
  const { data, error } = await supabase
    .from("app_users")
    .select("id, email, role, client_id, invited_by, created_at")
    .order("created_at", { ascending: false });

  const users = (data ?? []) as AppUser[];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {identity.isSuper
            ? "Every account with access."
            : "The client users you added."}{" "}
          Anyone with an @alttredmiinds.com address has team access
          automatically — no row needed.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-white">
            Add a client user
          </CardTitle>
          <CardDescription className="text-sm text-slate-400">
            They sign in with Google using this exact address and see only the
            client you choose. No invite email is sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddUserForm clients={clients} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-white">
            Access list
          </CardTitle>
          <CardDescription className="text-sm text-slate-400">
            {users.length} {users.length === 1 ? "account" : "accounts"}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error && (
            <p className="py-4 text-sm text-danger-foreground">
              Could not load users: {error.message}
            </p>
          )}
          <table className="w-full min-w-160 text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Email</th>
                <th className="py-2.5 pr-4 font-medium">Role</th>
                <th className="py-2.5 pr-4 font-medium">Client</th>
                <th className="py-2.5 pr-4 font-medium">Added by</th>
                <th className="py-2.5 pr-4 font-medium">Added</th>
                <th className="py-2.5 text-right font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && !error && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No client users yet. Add one above.
                  </td>
                </tr>
              )}
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-white/5 text-slate-300 last:border-0"
                >
                  <td className="py-2.5 pr-4">{user.email}</td>
                  <td className="py-2.5 pr-4">
                    {user.role === "super_admin" ? (
                      <StatusBadge status="success" label="Super admin" />
                    ) : (
                      <span className="text-slate-400">Client</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-400">
                    {user.client_id
                      ? (clientName.get(user.client_id) ?? user.client_id)
                      : "All clients"}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-400">
                    {user.invited_by === identity.email ? "You" : user.invited_by}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-slate-400 tabular-nums">
                    {ADDED.format(new Date(user.created_at))}
                  </td>
                  <td className="py-2.5 text-right">
                    {user.email === identity.email ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <form action={removeUser} className="inline">
                        <input type="hidden" name="id" value={user.id} />
                        <button
                          type="submit"
                          aria-label={`Remove ${user.email}`}
                          title={`Remove ${user.email}`}
                          className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

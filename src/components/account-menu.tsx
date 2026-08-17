import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import type { Identity } from "@/lib/auth/session";

/**
 * Who you are, and the way out. Sits at the foot of the sidebar; the role line
 * is what makes "why can't I see X" answerable without asking.
 */
export function AccountMenu({ identity }: { identity: Identity }) {
  const role = identity.isSuper
    ? "Super admin"
    : identity.isAdmin
      ? "Team"
      : "Client";

  return (
    <div className="flex items-center justify-between gap-2 border-t border-sidebar-border pt-4">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-slate-300">
          {identity.email}
        </span>
        <span className="text-xs text-slate-500">{role}</span>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut size={15} />
        </button>
      </form>
    </div>
  );
}

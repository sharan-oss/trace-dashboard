"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Filter, LayoutDashboard, Megaphone, Users, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/funnel", label: "Funnel", icon: Filter },
] as const;

// Client users have no rows visible in app_users, so the page would be an
// empty table for them — it is hidden rather than shown empty.
const ADMIN_ITEMS = [
  { href: "/settings/users", label: "Users", icon: UserCog },
] as const;

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS;

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto sm:flex-col">
      {items.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

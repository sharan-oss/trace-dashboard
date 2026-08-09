"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Filter, LayoutDashboard, Megaphone, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/ads", label: "Ads", icon: Megaphone },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/funnel", label: "Funnel", icon: Filter },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto sm:flex-col">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

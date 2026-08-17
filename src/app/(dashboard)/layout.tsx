import type * as React from "react";
import { redirect } from "next/navigation";
import { getIdentity, hasAccess } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";

/**
 * The real gate for every dashboard route. src/proxy.ts already bounces the
 * signed-out, but that is an optimistic check — this one runs server-side on
 * the verified session, and RLS runs behind it regardless.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!hasAccess(identity)) redirect("/no-access");

  return <AppShell identity={identity}>{children}</AppShell>;
}

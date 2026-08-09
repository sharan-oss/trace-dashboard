import type * as React from "react";
import { Vend_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import "./lp.css";

const vendSans = Vend_Sans({
  variable: "--font-vend-sans",
  subsets: ["latin"],
});

/**
 * Marketing pages live outside the dark AppShell: light canvas, own font
 * pair (Vend Sans display over the app's Geist body), all styles scoped in
 * lp.css so nothing leaks into the dashboard.
 */
export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={cn("lp min-h-screen w-full", vendSans.variable)}>
      {children}
    </div>
  );
}

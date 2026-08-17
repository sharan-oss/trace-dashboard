import type * as React from "react";

/** Centred single-card frame for the signed-out screens. No sidebar, no data. */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        {children}
      </div>
    </div>
  );
}

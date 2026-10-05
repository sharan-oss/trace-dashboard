"use client";

import type * as React from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Icon-only submit for a plain server-action <form>. While the action runs the
 * icon becomes a spinner and the button disables — the design system's loading
 * recipe. The icon comes in as children (a rendered element, not a component
 * reference) so server components can pass it across the client boundary.
 */
export function SubmitIconButton({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn("disabled:opacity-60", className)}
    >
      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : children}
    </button>
  );
}

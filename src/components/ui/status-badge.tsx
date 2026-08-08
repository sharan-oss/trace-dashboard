import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "success" | "warning" | "danger";

const STATUS_CONFIG: Record<
  Status,
  { icon: LucideIcon; bg: string; fg: string }
> = {
  success: { icon: CheckCircle2, bg: "bg-success", fg: "text-success-foreground" },
  warning: { icon: AlertTriangle, bg: "bg-warning", fg: "text-warning-foreground" },
  danger: { icon: XCircle, bg: "bg-danger", fg: "text-danger-foreground" },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  label: string;
  className?: string;
}) {
  const { icon: Icon, bg, fg } = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        bg,
        fg,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

import { CheckCircle2, AlertTriangle, XCircle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "success" | "warning" | "danger";

/**
 * Design-system status badge (§3.6): icon + word, colored text only — no
 * filled background. Color never stands alone; the icon and label always
 * accompany it.
 */
const STATUS_CONFIG: Record<Status, { icon: LucideIcon; fg: string }> = {
  success: { icon: CheckCircle2, fg: "text-success-foreground" },
  warning: { icon: AlertTriangle, fg: "text-warning-foreground" },
  danger: { icon: XCircle, fg: "text-danger-foreground" },
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
  const { icon: Icon, fg } = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        fg,
        className,
      )}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

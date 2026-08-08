import type { Icon as IconsaxIcon } from "iconsax-react";
import { TickCircle, Warning2, CloseCircle } from "iconsax-react";

import { cn } from "@/lib/utils";

type Status = "success" | "warning" | "danger";

const STATUS_CONFIG: Record<
  Status,
  { icon: IconsaxIcon; bg: string; fg: string }
> = {
  success: { icon: TickCircle, bg: "bg-success", fg: "text-success-foreground" },
  warning: { icon: Warning2, bg: "bg-warning", fg: "text-warning-foreground" },
  danger: { icon: CloseCircle, bg: "bg-danger", fg: "text-danger-foreground" },
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
      <Icon variant="Bulk" className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

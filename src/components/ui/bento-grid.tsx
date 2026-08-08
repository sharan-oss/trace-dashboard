import type * as React from "react";

import { cn } from "@/lib/utils";

export function BentoGrid({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6 auto-rows-[minmax(140px,auto)] sm:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}

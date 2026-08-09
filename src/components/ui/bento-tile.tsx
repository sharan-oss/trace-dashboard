import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const bentoTileVariants = cva(
  "rounded-2xl border border-border bg-card p-5 backdrop-blur-md",
  {
  variants: {
    size: {
      "1x1": "col-span-1 row-span-1",
      "2x1": "col-span-1 sm:col-span-2 row-span-1",
      "1x2": "col-span-1 row-span-2",
      "2x2": "col-span-1 sm:col-span-2 row-span-2",
    },
  },
  defaultVariants: {
    size: "1x1",
  },
});

export interface BentoTileProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bentoTileVariants> {}

export function BentoTile({ className, size, ...props }: BentoTileProps) {
  return <div className={cn(bentoTileVariants({ size, className }))} {...props} />;
}

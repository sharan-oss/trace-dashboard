import { cn } from "@/lib/utils";

/**
 * A placeholder bar for loading states — pulses gently, never shimmers, and
 * holds still under prefers-reduced-motion. Override size, radius and (for a
 * quieter secondary line) background via className.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded bg-white/10 motion-reduce:animate-none",
        className,
      )}
    />
  );
}

"use client";

import * as React from "react";

/**
 * Grows its child from 80% to 100% width as it scrolls into view — the
 * "expand as you arrive" product-shot moment. Hand-rolled (rAF + scroll)
 * for cross-browser smoothness; CSS scroll-timelines are still patchy in
 * Safari. Respects prefers-reduced-motion (renders at 100%, static).
 */
export function ScrollGrow({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      return;
    }
    let raf = 0;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // 0 as the frame's top enters the viewport bottom → 1 once it has
      // risen ~55% of the way up. Fully grown well before mid-screen.
      const raw = (window.innerHeight - rect.top) / (window.innerHeight * 0.55);
      setProgress(Math.min(1, Math.max(0, raw)));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
  const width = 80 + 20 * eased;
  const radius = 28 - 14 * eased;

  return (
    <div ref={ref} className="w-full">
      <div
        className="mx-auto overflow-hidden will-change-[width]"
        style={{ width: `${width}%`, borderRadius: `${radius}px` }}
      >
        {children}
      </div>
    </div>
  );
}

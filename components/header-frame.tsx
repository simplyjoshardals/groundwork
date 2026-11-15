"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The sticky 56 px header bar (DESIGN 4.2, 5.14). Its bottom edge is always
 * there but transparent until the page scrolls, so nothing shifts. A
 * zero-height sentinel at the top of the page tells us when we have left it
 * (an IntersectionObserver, not a scroll listener).
 */
export function HeaderFrame({ children }: { children: ReactNode }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setScrolled(!entry.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px -mb-px" />
      <header
        className={cn(
          "sticky top-0 z-30 border-b bg-bg transition-colors duration-(--dur-fast) ease-(--ease-settle)",
          scrolled ? "border-line" : "border-transparent",
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-[84rem] items-center gap-2 px-4 md:gap-3 md:px-6 xl:px-8">
          {children}
        </div>
      </header>
    </>
  );
}

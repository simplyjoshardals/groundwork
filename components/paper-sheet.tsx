import type { ComponentProps } from "react";
import { cn } from "@/components/ui/cn";

/**
 * One page of a document (DESIGN 3, 6.6): paper-colored in both themes, level-1
 * elevation, and in dark mode a ring plus `brightness(0.94)` so it is not a
 * white flashbang. Never inverted. `.paper` (globals.css) also gives the
 * citation highlight its paper strength. `className` is for width only.
 */
export function PaperSheet({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "paper relative rounded-sm shadow-card dark:ring-1 dark:ring-line dark:brightness-[0.94]",
        className,
      )}
      {...props}
    />
  );
}

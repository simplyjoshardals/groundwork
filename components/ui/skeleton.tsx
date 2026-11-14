import type { ComponentProps } from "react";
import { cn } from "./cn";

export type SkeletonProps = Omit<ComponentProps<"div">, "children"> & {
  /** `pill` is for badge-shaped placeholders (`rounded-full`). */
  shape?: "block" | "pill";
};

/**
 * One placeholder block. Size it to match the content that is coming
 * (DESIGN 5.9) so nothing jumps when it arrives. It is `aria-hidden`; the
 * region that contains skeletons should carry `aria-busy="true"` and, where
 * useful, a polite status line. Static under reduced motion (see globals.css).
 */
export function Skeleton({ shape = "block", className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "skeleton",
        shape === "pill" ? "rounded-full" : "rounded-sm",
        className,
      )}
      {...props}
    />
  );
}

import type { ComponentProps } from "react";
import { cn } from "./cn";

export type CardPadding = "compact" | "roomy";

export function cardClasses({
  padding = "compact",
  interactive = false,
  className,
}: {
  padding?: CardPadding;
  interactive?: boolean;
  className?: string;
} = {}): string {
  return cn(
    "rounded-lg border border-line bg-surface",
    padding === "roomy" ? "p-6" : "p-4",
    interactive &&
      "transition-shadow duration-(--dur-base) hover:border-control hover:shadow-card",
    className,
  );
}

export type CardProps = ComponentProps<"div"> & {
  padding?: CardPadding;
  /** Adds the hover elevation. Only for cards that are themselves clickable. */
  interactive?: boolean;
};

/**
 * A `div`. For list rows or footnotes that must be an `<li>` or `<article>`,
 * put `cardClasses()` on that element instead.
 */
export function Card({ padding, interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cardClasses({ padding, interactive, className })}
      {...props}
    />
  );
}

import type { ComponentProps } from "react";
import { cn } from "./cn";

export type InputProps = ComponentProps<"input">;

/**
 * 16 px text so iOS never zooms. 40 px tall, 48 px on touch devices (DESIGN
 * 4.2 asks for 48 px inputs on mobile). Invalid state is `aria-invalid`, not a
 * prop: set it and the border turns danger. Focus uses the global ring.
 * Prefer `Field`, which wires the label, helper and error text.
 */
export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "h-10 w-full rounded-md border border-control bg-surface px-3 text-base text-ink placeholder:text-muted pointer-coarse:h-12",
        "aria-[invalid=true]:border-danger",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-muted",
        className,
      )}
      {...props}
    />
  );
}

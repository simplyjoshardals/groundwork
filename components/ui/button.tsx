import type { ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-solid"
  | "link";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-sans font-medium transition-colors duration-(--dur-fast) ease-(--ease-settle) disabled:cursor-not-allowed pointer-coarse:min-h-11";

// `enabled:hover:` (not bare `hover:`) so a disabled button can never show a
// hover color, whatever order the generated CSS is in.
const DISABLED_FILLED = "disabled:bg-sunken disabled:text-muted disabled:border-line";

const VARIANTS: Record<Exclude<ButtonVariant, "link">, string> = {
  primary: `bg-accent text-accent-fg enabled:hover:bg-accent-hover ${DISABLED_FILLED}`,
  secondary: `border border-control bg-surface text-ink enabled:hover:bg-sunken ${DISABLED_FILLED}`,
  ghost: "text-ink enabled:hover:bg-sunken disabled:text-muted",
  danger: `border border-danger text-danger enabled:hover:bg-danger-soft ${DISABLED_FILLED}`,
  "danger-solid": `bg-danger text-danger-fg ${DISABLED_FILLED}`,
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

// Inline text only: no height, padding or touch-target floor, so it never
// breaks a line of prose.
const LINK =
  "text-accent underline underline-offset-4 transition-colors duration-(--dur-fast) enabled:hover:text-accent-hover disabled:cursor-not-allowed disabled:text-muted disabled:no-underline";

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  if (variant === "link") return cn(LINK, className);
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * Pending is the caller's job: swap the label ("Asking…"), set `disabled`,
 * and give the button a `min-w` so its width does not change. No spinner.
 * `type` defaults to "button" (not the HTML default "submit") so a stray
 * button in a form never submits it; pass `type="submit"` explicitly.
 *
 * For a link that looks like a button, use `buttonClasses()` on `<Link>`.
 */
export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  );
}

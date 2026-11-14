import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import { ErrorIcon, InfoIcon, WarningIcon, type IconProps } from "./icons";

export type BannerTone = "info" | "warn" | "danger";

// A banner is a slip of paper with a small tab at the start: a full hairline
// frame (the left rule is the margin-note motif and belongs to the cited
// passage, DESIGN 6.6), and an icon in a paper chip. The frame firms up as
// urgency rises: neutral line, tinted, then nearly solid. The icon shape
// differs by tone too (circle-i, triangle, octagon).
const TONES: Record<
  BannerTone,
  {
    box: string;
    chip: string;
    role: "status" | "alert";
    Icon: (props: IconProps) => ReactElement;
  }
> = {
  info: {
    box: "border-line bg-sunken",
    chip: "border-line text-muted",
    role: "status",
    Icon: InfoIcon,
  },
  warn: {
    box: "border-warn/35 bg-warn-soft",
    chip: "border-warn/30 text-warn",
    role: "status",
    Icon: WarningIcon,
  },
  danger: {
    box: "border-danger/60 bg-danger-soft",
    chip: "border-danger/40 text-danger",
    role: "alert",
    Icon: ErrorIcon,
  },
};

export type BannerProps = Omit<ComponentProps<"div">, "role" | "children"> & {
  tone?: BannerTone;
  children: ReactNode;
  /** A retry or next-step control, usually `<Button variant="secondary" size="sm">`. */
  action?: ReactNode;
};

/**
 * Inline notice. `danger` is `role="alert"` (blocks the user), the others
 * `role="status"`. Banners that appear after the page loads are announced,
 * so render them only when there is something to say. Reserve space for
 * ones that can appear in a stable spot, or they will shift the layout.
 */
export function Banner({
  tone = "info",
  action,
  className,
  children,
  ...props
}: BannerProps) {
  const { box, chip, role, Icon } = TONES[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex md:items-center gap-3 rounded-md border p-3 text-sm text-ink",
        box,
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-sm border bg-surface",
          chip,
        )}
      >
        <Icon />
      </span>
      <div className="flex min-h-7 min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 py-1 text-pretty">{children}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
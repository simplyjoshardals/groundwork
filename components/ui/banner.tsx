import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { ErrorIcon, InfoIcon, WarningIcon } from "./icons";

export type BannerTone = "info" | "warn" | "danger";

const TONES: Record<
  BannerTone,
  { box: string; icon: string; role: "status" | "alert"; Icon: typeof InfoIcon }
> = {
  info: {
    box: "border-control bg-sunken",
    icon: "text-muted",
    role: "status",
    Icon: InfoIcon,
  },
  warn: {
    box: "border-warn bg-warn-soft",
    icon: "text-warn",
    role: "status",
    Icon: WarningIcon,
  },
  danger: {
    box: "border-danger bg-danger-soft",
    icon: "text-danger",
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
  const { box, icon, role, Icon } = TONES[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex gap-3 md:items-center rounded-md border-l-2 px-4 py-3 text-sm text-ink",
        box,
        className,
      )}
      {...props}
    >
      <span className={cn("flex h-5 shrink-0 items-center", icon)}>
        <Icon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">{children}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

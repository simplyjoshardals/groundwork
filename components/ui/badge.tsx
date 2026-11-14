import type { ComponentProps } from "react";
import { cn } from "./cn";
import { CheckIcon } from "./icons";

export type BadgeStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "sample";

const LABELS: Record<BadgeStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  sample: "Sample",
};

const COLORS: Record<BadgeStatus, string> = {
  queued: "bg-sunken text-muted",
  processing: "bg-accent-soft text-accent",
  ready: "bg-accent-soft text-accent",
  failed: "bg-danger-soft text-danger",
  sample: "bg-highlight-soft text-ink",
};

const DOT = "size-1.5 shrink-0 rounded-full";

function Marker({ status }: { status: BadgeStatus }) {
  switch (status) {
    case "queued":
      return <span aria-hidden="true" className={cn(DOT, "border border-current")} />;
    case "processing":
      return <span aria-hidden="true" className={cn(DOT, "bg-current dot-pulse")} />;
    case "failed":
      return <span aria-hidden="true" className={cn(DOT, "bg-current")} />;
    case "ready":
      // The check replaces the dot: a distinct shape, so Ready never depends
      // on color alone. (DESIGN 5.4 "solid, with a check glyph".)
      return <CheckIcon size={12} />;
    case "sample":
      return null;
  }
}

export type BadgeProps = Omit<ComponentProps<"span">, "children"> & {
  status: BadgeStatus;
};

/** The label is always rendered: color is never the only signal. */
export function Badge({ status, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium",
        COLORS[status],
        className,
      )}
      {...props}
    >
      <Marker status={status} />
      {LABELS[status]}
    </span>
  );
}

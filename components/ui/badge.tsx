import type { ComponentProps, ReactElement } from "react";
import { cn } from "./cn";
import {
  FailedIcon,
  type IconProps,
  ProcessingIcon,
  QueuedIcon,
  ReadyIcon,
  SampleIcon,
} from "./icons";

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

// Every badge is a soft fill with a hairline edge in its own tone. Queued is
// the exception that proves the rule: no fill and a dashed edge, a slot
// still waiting to be filled. Nothing animates.
const STYLES: Record<BadgeStatus, string> = {
  queued: "border-dashed border-control bg-transparent text-muted",
  processing: "border-current/20 bg-accent-soft text-accent",
  ready: "border-current/20 bg-accent-soft text-accent",
  failed: "border-current/25 bg-danger-soft text-danger",
  sample: "border-highlight/60 bg-highlight-soft text-ink",
};

// A different glyph per status, so the shape says it as well as the color
// and the label: clock, half circle, check, exclamation, bookmark.
const GLYPHS: Record<BadgeStatus, (props: IconProps) => ReactElement> = {
  queued: QueuedIcon,
  processing: ProcessingIcon,
  ready: ReadyIcon,
  failed: FailedIcon,
  sample: SampleIcon,
};

export type BadgeProps = Omit<ComponentProps<"span">, "children"> & {
  status: BadgeStatus;
};

/** The label is always rendered: color is never the only signal. */
export function Badge({ status, className, ...props }: BadgeProps) {
  const Glyph = GLYPHS[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border pr-2 pl-1.5 text-xs font-medium",
        STYLES[status],
        className,
      )}
      {...props}
    >
      <Glyph />
      {LABELS[status]}
    </span>
  );
}
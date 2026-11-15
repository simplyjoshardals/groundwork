"use client";

import { useSyncExternalStore } from "react";
import { WarningIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { useUsage } from "@/components/usage-context";
import { describeCounter } from "@/lib/ask-client";

const noopSubscribe = () => () => undefined;

/**
 * The header's question counter (DESIGN 5.13). A polite live region: it is
 * announced when an answer changes it, not on first paint. Its box has a fixed
 * minimum width so a change of digits never moves the header.
 */
export function QuestionCounter() {
  const { usage } = useUsage();
  // The reset time shows in the reader's zone. The server (and hydration)
  // use UTC, so the HTML matches, and the local time appears right after.
  const timeZone = useSyncExternalStore<string | undefined>(
    noopSubscribe,
    () => undefined,
    () => "UTC",
  );
  const text =
    usage === null
      ? {
          label: "– left",
          description: "Question count unavailable.",
          empty: false,
        }
      : describeCounter(usage, timeZone);

  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      title={text.description}
      className={cn(
        "flex min-w-[7rem] items-center justify-end gap-1.5 whitespace-nowrap font-mono text-sm tabular-nums",
        text.empty ? "text-warn" : "text-muted",
      )}
    >
      {text.empty ? <WarningIcon /> : null}
      <span aria-hidden="true">{text.label}</span>
      <span className="sr-only">{text.description}</span>
    </p>
  );
}

"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/lib/net/use-online-status";

/**
 * A viewer failure as a banner (DESIGN 6.6): danger, with Retry when trying
 * again can help. A transient failure while the browser is offline becomes a
 * warn banner that says so (state O), because Retry cannot work until the
 * connection is back. A page already on screen is never replaced by this.
 */
export function ViewerFailure({
  message,
  transient,
  onRetry,
}: {
  message: string;
  /** A network-type failure: worth a Retry, and explained by being offline. */
  transient: boolean;
  /** Omit when Retry cannot help. */
  onRetry?: () => void;
}) {
  const online = useOnlineStatus();
  const offline = !online && transient;
  return (
    <Banner
      tone={offline ? "warn" : "danger"}
      action={
        onRetry === undefined ? undefined : (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {offline
        ? "You’re offline. Reconnect, then try again."
        : message}
    </Banner>
  );
}

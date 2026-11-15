"use client";

import { useSyncExternalStore } from "react";
import { OfflineBanner } from "@/components/offline-banner";
import { ReloadButton } from "@/components/reload-button";
import {
  browserSessionStorage,
  wasRecentlyRetried,
} from "@/lib/auth/waiting-retry";
import { useOnlineStatus } from "@/lib/net/use-online-status";

const subscribeNever = () => () => undefined;

/**
 * The body of the waiting page (DESIGN 6.7). Offline replaces the
 * explanation. The second line is always in the DOM and always one line tall:
 * it says how long this usually takes, and after a recent retry it says
 * "Still not reachable" instead. Because it is never empty it leaves no hole,
 * and because it never changes height the button never moves.
 */
export function WaitingContent() {
  const online = useOnlineStatus();
  const retried = useSyncExternalStore(
    subscribeNever,
    () => wasRecentlyRetried(browserSessionStorage()),
    () => false,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {online ? (
          <p className="text-base text-ink">
            The database is starting after a quiet spell.
          </p>
        ) : (
          <OfflineBanner>You’re offline.</OfflineBanner>
        )}
        <p role="status" className="min-h-5 text-sm text-muted">
          {online
            ? retried
              ? "Still not reachable. Try again in a minute."
              : "This usually takes under a minute."
            : null}
        </p>
      </div>
      <ReloadButton />
    </div>
  );
}
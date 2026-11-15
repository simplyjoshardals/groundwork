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
 * explanation; a recent retry adds "Still not reachable". The status line is
 * always in the DOM with its height reserved, so it appears without moving
 * the button.
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
      {online ? (
        <p className="text-base text-ink">
          The database is starting after a quiet spell. This usually takes under
          a minute.
        </p>
      ) : (
        <OfflineBanner>You’re offline.</OfflineBanner>
      )}
      <p role="status" className="min-h-5 text-sm text-muted">
        {online && retried
          ? "Still not reachable. Try again in a minute."
          : null}
      </p>
      <ReloadButton />
    </div>
  );
}

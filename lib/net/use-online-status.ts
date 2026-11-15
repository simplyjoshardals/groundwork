"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * `navigator.onLine`, kept in sync with the browser's online and offline
 * events. The server (and the first hydration pass) assume online, so nothing
 * flashes a warning for visitors who are connected. `onLine === false` is
 * reliable; `true` only means "some network", which is why a failed request
 * still has to be reported on its own.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

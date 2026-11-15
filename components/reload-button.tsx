"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  browserSessionStorage,
  markWaitingRetry,
} from "@/lib/auth/waiting-retry";
import { useOnlineStatus } from "@/lib/net/use-online-status";

/**
 * Full reload, so the server re-checks the session (Task 5.9 waiting page).
 * It notes the attempt first, so the reloaded page can say "Still not
 * reachable". The width is fixed: "Checking…" must not resize the button.
 * `onReload` exists so tests do not have to reload jsdom.
 */
export function ReloadButton({
  onReload = () => window.location.reload(),
}: {
  onReload?: () => void;
}) {
  const online = useOnlineStatus();
  const [checking, setChecking] = useState(false);

  function retry() {
    markWaitingRetry(browserSessionStorage());
    setChecking(true);
    onReload();
  }

  return (
    <Button
      variant="secondary"
      className="min-w-[8rem] self-start"
      disabled={checking || !online}
      onClick={retry}
    >
      {checking ? "Checking…" : "Try again"}
    </Button>
  );
}

"use client";

import type { ReactNode } from "react";
import { Banner } from "@/components/ui/banner";
import { useOnlineStatus } from "@/lib/net/use-online-status";

/**
 * A warn banner that exists only while the browser reports it is offline, so
 * it is announced once when the connection drops and not at all otherwise.
 * (The app-wide banner under the workspace header, DESIGN 6.8, arrives with
 * the U2 shell; this is the page-level piece it will reuse.)
 */
export function OfflineBanner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <Banner tone="warn" className={className}>
      {children}
    </Banner>
  );
}

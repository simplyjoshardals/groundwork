"use client";

import Link from "next/link";
import { StatePage } from "@/components/state-page";
import { Button, buttonClasses } from "@/components/ui/button";

/**
 * The body of `error.tsx` and `global-error.tsx` (DESIGN 6.8). Never a stack
 * trace or a provider message. `plainLinks` swaps `next/link` for a real
 * anchor for `global-error`, where the router may be what failed.
 */
export function ErrorState({
  reset,
  plainLinks = false,
}: {
  reset: () => void;
  plainLinks?: boolean;
}) {
  const home = buttonClasses({ variant: "link" });
  return (
    <StatePage title="Something broke on our side." plainLinks={plainLinks}>
      <p className="text-base text-ink">
        Try again, or head back to the start.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={reset}>Try again</Button>
        {plainLinks ? (
          // A real anchor on purpose: a full page load is the way back from a
          // crash, and a client-side transition would re-render the root layout
          // that may have just failed.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/" className={home}>
            Go to the start
          </a>
        ) : (
          <Link href="/" className={home}>
            Go to the start
          </Link>
        )}
      </div>
    </StatePage>
  );
}
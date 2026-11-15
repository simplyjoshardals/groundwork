"use client";

import type { CSSProperties } from "react";
import { ErrorState } from "@/components/error-state";
import { THEME_SCRIPT } from "@/lib/theme/theme-script";
import "./globals.css";

// `global-error` replaces the root layout, so the `next/font` variables do not
// exist here. Without these, `var(--font-newsreader)` is undefined and the
// whole font-family declaration is dropped (the page would fall back to the
// browser default). System faces are acceptable only on this last-resort page.
const FALLBACK_FONTS = {
  "--font-newsreader": "Georgia",
  "--font-instrument": "system-ui",
  "--font-geist-mono": "ui-monospace",
} as CSSProperties;

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
      style={FALLBACK_FONTS}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ErrorState reset={reset} plainLinks />
      </body>
    </html>
  );
}

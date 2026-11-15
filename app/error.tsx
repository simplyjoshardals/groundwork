"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest ties this to the server log; the UI never shows it.
    console.error("[error-page]", error.digest ?? error.name);
  }, [error]);
  return <ErrorState reset={reset} />;
}

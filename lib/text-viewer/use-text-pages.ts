"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  loadTextFile,
  type TextFileFailureReason,
  type TextFileResult,
} from "./load-text-file";
import { buildTextPages } from "./pages";

export type TextPagesState =
  | { state: "loading" }
  /** `pages` is empty for a file with no text. */
  | { state: "ready"; pages: readonly string[] }
  | { state: "error"; reason: TextFileFailureReason };

/** Loads and paginates the file with the browser (user) session; never throws. */
async function load(
  storagePath: string,
  signal: AbortSignal,
): Promise<TextFileResult> {
  try {
    return await loadTextFile(createBrowserSupabase(), storagePath, {
      signal,
    });
  } catch (error) {
    // Name only: messages could carry configuration details.
    console.error(
      "[text-viewer] file load failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, reason: "failed" };
  }
}

type Settled = { key: string; state: TextPagesState };

/**
 * Resolves a storage path to the file's virtual pages. Results are keyed by
 * path and retry attempt, so a late answer for an earlier document is never
 * shown for the current one (same pattern as `useViewerDocument`).
 */
export function useTextPages(storagePath: string): {
  state: TextPagesState;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = `${storagePath}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void load(storagePath, controller.signal).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setSettled({ key, state: { state: "error", reason: result.reason } });
        return;
      }
      try {
        setSettled({
          key,
          state: { state: "ready", pages: buildTextPages(result.text) },
        });
      } catch (error) {
        console.error(
          "[text-viewer] pagination failed:",
          error instanceof Error ? error.name : "unknown",
        );
        setSettled({ key, state: { state: "error", reason: "invalid_text" } });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, storagePath]);

  return {
    state:
      settled !== null && settled.key === key
        ? settled.state
        : { state: "loading" },
    retry: () => setAttempt((count) => count + 1),
  };
}

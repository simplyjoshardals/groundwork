"use client";

import { useEffect, useState } from "react";
import { getChunk, type ChunkPassage, type ChunkResult } from "@/lib/documents/get-chunk";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export type ChunkPassageState =
  /** The link names no chunk. */
  | { state: "none" }
  | { state: "loading" }
  | { state: "ready"; chunk: ChunkPassage }
  /** Missing, or not readable by this session (the database does not say which). */
  | { state: "unavailable" }
  /** Network or database error; worth a retry. */
  | { state: "error" };

/** Loads the chunk with the browser (user) session; never throws. */
async function loadChunk(chunkId: string): Promise<ChunkResult> {
  try {
    return await getChunk(createBrowserSupabase(), chunkId);
  } catch (error) {
    // Name only: messages could carry configuration details.
    console.error(
      "[viewer-panel] chunk lookup failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, reason: "failed" };
  }
}

/**
 * Resolves `?chunk=<id>` to the cited passage (Task 3.5). Results are keyed by
 * chunk id and retry attempt, so a late answer for an earlier chunk can never
 * be shown for the current one. Pass `null` for no lookup (no chunk in the
 * link, or a document that is not a PDF).
 */
export function useChunkPassage(chunkId: string | null): {
  state: ChunkPassageState;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    result: ChunkResult;
  } | null>(null);
  const key = chunkId === null ? null : `${chunkId}#${attempt}`;

  useEffect(() => {
    if (key === null || chunkId === null) return;
    let cancelled = false;
    void loadChunk(chunkId).then((result) => {
      if (!cancelled) setSettled({ key, result });
    });
    return () => {
      cancelled = true;
    };
  }, [key, chunkId]);

  let state: ChunkPassageState;
  if (key === null) {
    state = { state: "none" };
  } else if (settled === null || settled.key !== key) {
    state = { state: "loading" };
  } else if (settled.result.ok) {
    state = { state: "ready", chunk: settled.result.chunk };
  } else if (settled.result.reason === "not_found") {
    state = { state: "unavailable" };
  } else {
    state = { state: "error" };
  }
  return { state, retry: () => setAttempt((count) => count + 1) };
}

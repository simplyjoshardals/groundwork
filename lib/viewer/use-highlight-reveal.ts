"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scrollToPassage } from "./scroll-to-passage";
import { WIPE_DONE_AFTER_MS, WIPE_SAFETY_MS, staggerDelays } from "./wipe";

/** What `data-wipe` on the paper sheet says: `pending` hides, `play` animates. */
export type WipePhase = "pending" | "play";

/**
 * The highlight wipe (DESIGN 7): the cited passage is drawn hidden, the page
 * scrolls to it, and once the scroll has settled the highlight grows once from
 * left to right. `activeKey` names the highlight currently drawn (`null` when
 * there is none); the same key never wipes twice, so a resize that redraws the
 * text layer does not replay it. `phase` goes on the paper sheet as
 * `data-wipe`; `undefined` means "just show it".
 *
 * Safety net: a highlight is never left hidden. If `reveal` does not report
 * back, the wipe starts after `WIPE_SAFETY_MS` anyway.
 */
export function useHighlightReveal(activeKey: string | null): {
  phase: WipePhase | undefined;
  /** Call with the drawn `mark` elements, in reading order, once they exist. */
  reveal: (marks: readonly HTMLElement[], key: string) => Promise<void>;
} {
  const [played, setPlayed] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const activeRef = useRef(activeKey);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeRef.current = activeKey;
  }, [activeKey]);

  useEffect(() => {
    if (played === null) return;
    const timer = setTimeout(() => setFinished(played), WIPE_DONE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [played]);

  useEffect(() => {
    if (activeKey === null) return;
    const timer = setTimeout(
      () => setPlayed((current) => (current === activeKey ? current : activeKey)),
      WIPE_SAFETY_MS,
    );
    return () => clearTimeout(timer);
  }, [activeKey]);

  const reveal = useCallback(
    async (marks: readonly HTMLElement[], key: string) => {
      if (marks.length === 0) return;
      staggerDelays(marks.length).forEach((delay, index) => {
        marks[index]?.style.setProperty("--wipe-delay", `${delay}ms`);
      });
      await scrollToPassage(marks);
      if (aliveRef.current && activeRef.current === key) setPlayed(key);
    },
    [],
  );

  let phase: WipePhase | undefined;
  if (activeKey !== null && finished !== activeKey) {
    phase = played === activeKey ? "play" : "pending";
  }
  return { phase, reveal };
}

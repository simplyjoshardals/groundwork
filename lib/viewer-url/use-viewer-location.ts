"use client";

import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  parseViewerLocation,
  withViewerParams,
  type ViewerLocation,
  type ViewerTarget,
} from "./location";

export interface ViewerLocationControls {
  location: ViewerLocation;
  /** Shows a document. Pushes a history entry only if the viewer was closed. */
  open: (target: ViewerTarget) => void;
  /** Changes the page of the open document (replaces the entry). */
  setPage: (page: number) => void;
  /** Closes the viewer: the same as Back when this session opened it. */
  close: () => void;
}

/** Reads the live URL, so handlers never act on a stale render. */
function readCurrent(): ViewerLocation {
  return parseViewerLocation(new URLSearchParams(window.location.search));
}

function urlWith(target: ViewerTarget | null): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${withViewerParams(search, target)}${hash}`;
}

/**
 * Viewer state kept in the URL with the native History API, which Next.js
 * syncs with `useSearchParams` (no server round trip).
 *
 * History rules, so Back closes the viewer and never walks through pages:
 * opening from closed pushes one entry; switching citation and turning pages
 * replace it. `close` goes back one entry only when this session pushed it;
 * after a refresh or a shared link there is no such entry, so it rewrites the
 * URL in place instead of leaving the app. "Pushed" is tracked in memory, not
 * in `history.state`, which Next.js owns.
 */
export function useViewerLocation(): ViewerLocationControls {
  const searchParams = useSearchParams();
  const location = useMemo(
    () => parseViewerLocation(searchParams),
    [searchParams],
  );
  const pushedRef = useRef(false);

  const open = useCallback((target: ViewerTarget) => {
    const url = urlWith(target);
    if (readCurrent().status === "closed") {
      window.history.pushState(null, "", url);
      pushedRef.current = true;
    } else {
      window.history.replaceState(null, "", url);
    }
  }, []);

  const setPage = useCallback((page: number) => {
    const current = readCurrent();
    if (current.status !== "open") return;
    if (current.page === page) return;
    window.history.replaceState(null, "", urlWith({ ...current, page }));
  }, []);

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", urlWith(null));
  }, []);

  return { location, open, setPage, close };
}

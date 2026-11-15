/**
 * The waiting page (DESIGN 6.7) shows "Still not reachable" when the visitor
 * has already pressed "Try again". The retry is a full reload, so the memory
 * has to survive it: a timestamp in `sessionStorage`. A timestamp, not a flag,
 * so an old flag from an earlier episode never makes a fresh visit look like a
 * second attempt.
 */
export const WAITING_RETRY_KEY = "groundwork-waiting-retry";
export const WAITING_RETRY_WINDOW_MS = 120_000;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** `sessionStorage`, or `null` where it is blocked (private mode, policies). */
export function browserSessionStorage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function markWaitingRetry(
  storage: StorageLike | null,
  now: number = Date.now(),
): void {
  try {
    storage?.setItem(WAITING_RETRY_KEY, String(now));
  } catch {
    // Storage full or blocked: the page just will not say "still".
  }
}

export function wasRecentlyRetried(
  storage: StorageLike | null,
  now: number = Date.now(),
): boolean {
  try {
    const raw = storage?.getItem(WAITING_RETRY_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return (
      Number.isFinite(at) && now >= at && now - at < WAITING_RETRY_WINDOW_MS
    );
  } catch {
    return false;
  }
}

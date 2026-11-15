import { describe, expect, it } from "vitest";
import {
  markWaitingRetry,
  wasRecentlyRetried,
  WAITING_RETRY_WINDOW_MS,
  type StorageLike,
} from "@/lib/auth/waiting-retry";

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("waiting retry memory", () => {
  it("is false before any retry", () => {
    expect(wasRecentlyRetried(memoryStorage(), 1_000)).toBe(false);
  });

  it("is true shortly after a retry and false once the window has passed", () => {
    const storage = memoryStorage();
    markWaitingRetry(storage, 1_000);
    expect(wasRecentlyRetried(storage, 1_000 + 5_000)).toBe(true);
    expect(wasRecentlyRetried(storage, 1_000 + WAITING_RETRY_WINDOW_MS)).toBe(
      false,
    );
  });

  it("ignores a value that is not a timestamp", () => {
    const storage = memoryStorage();
    storage.setItem("groundwork-waiting-retry", "yes");
    expect(wasRecentlyRetried(storage, 1_000)).toBe(false);
  });

  it("never throws when storage is missing or broken", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => markWaitingRetry(null)).not.toThrow();
    expect(() => markWaitingRetry(broken)).not.toThrow();
    expect(wasRecentlyRetried(null)).toBe(false);
    expect(wasRecentlyRetried(broken)).toBe(false);
  });
});

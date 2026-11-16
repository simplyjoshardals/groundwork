import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "@/lib/viewer-prefetch/cache";

type Result = { ok: boolean };

function setup() {
  let time = 0;
  const cache = createTtlCache<Result>({
    ttlMs: 60_000,
    isCacheable: (r) => r.ok,
    now: () => time,
  });
  return { cache, advance: (ms: number) => (time += ms) };
}

describe("createTtlCache", () => {
  it("serves a success from memory within the ttl", async () => {
    const { cache } = setup();
    const load = vi.fn(async () => ({ ok: true }));
    await cache.get("a", load);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads again once the entry is older than the ttl", async () => {
    const { cache, advance } = setup();
    const load = vi.fn(async () => ({ ok: true }));
    await cache.get("a", load);
    advance(60_001);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between a prefetch and a get", async () => {
    const { cache } = setup();
    let resolve!: (r: Result) => void;
    const load = vi.fn(() => new Promise<Result>((r) => (resolve = r)));
    cache.prefetch("a", load);
    const pending = cache.get("a", load);
    resolve({ ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep failures, so a retry asks again", async () => {
    const { cache } = setup();
    const load = vi.fn(async () => ({ ok: false }));
    await cache.get("a", load);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected prefetch and lets a later get retry", async () => {
    const { cache } = setup();
    cache.prefetch("a", () => Promise.reject(new Error("offline")));
    await new Promise((resolve) => setTimeout(resolve, 0)); // let it settle
    const load = vi.fn(async () => ({ ok: true }));
    await expect(cache.get("a", load)).resolves.toEqual({ ok: true });
  });

  it("does not store a result that was still loading when the cache was cleared", async () => {
    const { cache } = setup();
    let resolve!: (r: Result) => void;
    const slow = vi.fn(() => new Promise<Result>((r) => (resolve = r)));
    const pending = cache.get("a", slow);
    cache.clear();
    resolve({ ok: true });
    await pending;

    const next = vi.fn(async () => ({ ok: true }));
    await cache.get("a", next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
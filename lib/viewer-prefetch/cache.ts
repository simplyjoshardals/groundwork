/**
 * A tiny in-memory cache for the viewer's document and chunk lookups, so
 * hovering or focusing a citation marker can start them before the click.
 *
 * - Only successes are stored: a failure or a "not found" is asked again, so
 *   the viewer's Retry always goes to the network.
 * - A request already in flight is shared, so a hover followed by a click
 *   makes one query, not two.
 * - Entries expire after `ttlMs` and nothing is persisted: a reload empties
 *   it. Lookups run as the browser user (RLS decides), and results are keyed
 *   by id only, so the owner clears it when the signed-in user changes (see
 *   `index.ts`). `clear()` also stops requests already in flight from storing
 *   their result afterwards.
 */
export interface TtlCache<T> {
  /** Resolves from the cache, a shared in-flight request, or `load`. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** Starts a load without waiting for it; errors are swallowed. */
  prefetch(key: string, load: () => Promise<T>): void;
  clear(): void;
}

export function createTtlCache<T>(options: {
  ttlMs: number;
  /** Which results are worth keeping. */
  isCacheable: (value: T) => boolean;
  now?: () => number;
}): TtlCache<T> {
  const now = options.now ?? Date.now;
  const stored = new Map<string, { value: T; expires: number }>();
  const inFlight = new Map<string, Promise<T>>();
  /** Bumped by `clear()`; a load started before it must not store its result. */
  let generation = 0;

  function get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = stored.get(key);
    if (hit) {
      if (hit.expires > now()) return Promise.resolve(hit.value);
      stored.delete(key);
    }
    const pending = inFlight.get(key);
    if (pending) return pending;

    const startedIn = generation;
    const request = load()
      .then((value) => {
        if (startedIn === generation && options.isCacheable(value)) {
          stored.set(key, { value, expires: now() + options.ttlMs });
        }
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  return {
    get,
    prefetch(key, load) {
      get(key, load).catch(() => undefined);
    },
    clear() {
      generation += 1;
      stored.clear();
      inFlight.clear();
    },
  };
}
"use client";

/**
 * TEMPORARY page for Task 0.8 (streaming spike). Delete it, together with
 * app/api/spike-stream/, once the result is recorded.
 *
 * Reads /api/spike-stream with fetch and a stream reader (not EventSource,
 * because Task 1.9 will use POST) and shows when each event ARRIVED. If the
 * platform buffers the response, every event arrives at about the same time.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface StreamEvent {
  type: "tick" | "done";
  seq: number;
  serverMs: number;
}

interface Arrival {
  event: StreamEvent;
  /** Milliseconds between clicking Start and this chunk being read. */
  clientMs: number;
}

type Status = "idle" | "streaming" | "done" | "error";

// Expected when streaming works: first tick near 300 ms, last near 4800 ms.
const MAX_FIRST_TICK_MS = 1_500;
const MIN_SPREAD_MS = 3_000;

function parseFrame(frame: string): StreamEvent | null {
  const line = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return null; // comment frames carry no data
  let value: unknown;
  try {
    value = JSON.parse(line.slice("data:".length).trim());
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { type, seq, serverMs } = value as Record<string, unknown>;
  if (
    (type === "tick" || type === "done") &&
    typeof seq === "number" &&
    typeof serverMs === "number"
  ) {
    return { type, seq, serverMs };
  }
  return null;
}

function judge(arrivals: Arrival[]): string | null {
  const ticks = arrivals.filter((a) => a.event.type === "tick");
  if (ticks.length < 2) return null;
  const first = ticks[0].clientMs;
  const last = ticks[ticks.length - 1].clientMs;
  const spread = last - first;
  const incremental = first < MAX_FIRST_TICK_MS && spread > MIN_SPREAD_MS;
  const summary = `First tick at ${first} ms, last at ${last} ms (spread ${spread} ms).`;
  return incremental
    ? `Incremental. ${summary}`
    : `Possibly buffered. ${summary} Expect a first tick under ${MAX_FIRST_TICK_MS} ms and a spread over ${MIN_SPREAD_MS} ms.`;
}

export default function StreamSpikePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("streaming");
    setError(null);
    setArrivals([]);

    const t0 = performance.now();
    let sawDone = false;

    try {
      const res = await fetch("/api/spike-stream", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server answered HTTP ${res.status}`);
      if (!res.body) throw new Error("The response has no body to read");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Frames end with a blank line; keep any partial frame for next read.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        const clientMs = Math.round(performance.now() - t0);
        const batch: Arrival[] = [];
        for (const frame of frames) {
          const event = parseFrame(frame);
          if (!event) continue;
          if (event.type === "done") sawDone = true;
          batch.push({ event, clientMs });
        }
        if (batch.length > 0) setArrivals((prev) => [...prev, ...batch]);
      }

      if (!sawDone) throw new Error("The stream ended before the done event");
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) return; // replaced by a newer run
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, []);

  const verdict = status === "done" ? judge(arrivals) : null;

  return (
    <main className="mx-auto w-full max-w-xl p-6">
      <h1 className="text-xl font-semibold">Streaming spike (Task 0.8)</h1>
      <p className="mt-2 text-sm text-neutral-600">
        The server sends a tick every 300 ms for about 5 seconds. Each row shows
        when it arrived here. Rows should appear one at a time.
      </p>

      <button
        type="button"
        onClick={start}
        disabled={status === "streaming"}
        className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {status === "streaming" ? "Streaming…" : "Start"}
      </button>

      <p className="mt-4 text-sm" role="status" aria-live="polite">
        {status === "idle" && "Press Start."}
        {status === "streaming" &&
          `Receiving… ${arrivals.length} events so far.`}
        {status === "done" && "Stream finished."}
        {status === "error" && (
          <span className="text-red-700">Failed: {error}</span>
        )}
      </p>

      {verdict && <p className="mt-2 text-sm font-medium">{verdict}</p>}

      {arrivals.length > 0 && (
        <table className="mt-4 w-full text-left text-sm tabular-nums">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-4 font-medium">Event</th>
              <th className="py-1 pr-4 font-medium">Server (ms)</th>
              <th className="py-1 font-medium">Arrived (ms after click)</th>
            </tr>
          </thead>
          <tbody>
            {arrivals.map(({ event, clientMs }) => (
              <tr key={event.seq} className="border-b border-neutral-200">
                <td className="py-1 pr-4">
                  {event.type} {event.seq}
                </td>
                <td className="py-1 pr-4">{event.serverMs}</td>
                <td className="py-1">{clientMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

/**
 * TEMPORARY route for Task 0.8 (streaming spike). Delete it, together with
 * app/spike/stream/, once the result is recorded.
 *
 * Sends 16 `tick` events 300 ms apart, then a `done` event at about 5 s, as
 * Server-Sent-Events-style frames (`data: <json>` followed by a blank line).
 * The event shape is throwaway: the real contract belongs to Task 1.8.
 *
 * Deliberately open (no SPIKE_TOKEN): the browser page cannot hold a secret,
 * and this route takes no input and returns nothing sensitive.
 */

// Vercel docs (https://vercel.com/docs/functions/limitations, read 2026-11-01):
// Hobby is 300 s default and 300 s maximum with Fluid compute, and streamed
// time counts towards it. This stream needs about 5 s, so 10 s leaves headroom.
// Task 1.9 should choose its own value deliberately.
export const maxDuration = 10;

const TICK_MS = 300;
const TICK_COUNT = 16; // 16 x 300 ms = 4.8 s
const TOTAL_MS = 5_000;

interface StreamEvent {
  type: "tick" | "done";
  seq: number;
  /** Milliseconds since the handler started, measured on the server. */
  serverMs: number;
}

export function GET(request: Request): Response {
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let cancelled = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let finish: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    cancelled = true;
    clearInterval(interval);
    clearTimeout(finish);
  };

  // The Response is returned straight away; all timed work happens inside the
  // stream. Awaiting before returning is the classic way to cause buffering.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent): void => {
        if (cancelled) return;
        const frame = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      // A comment frame (ignored by the client) so the response headers and
      // first bytes leave immediately instead of waiting for the first tick.
      controller.enqueue(encoder.encode(": stream open\n\n"));

      let seq = 0;
      interval = setInterval(() => {
        seq += 1;
        send({ type: "tick", seq, serverMs: Date.now() - startedAt });
        if (seq < TICK_COUNT) return;
        clearInterval(interval);
        finish = setTimeout(
          () => {
            send({
              type: "done",
              seq: seq + 1,
              serverMs: Date.now() - startedAt,
            });
            if (!cancelled) controller.close();
          },
          TOTAL_MS - TICK_COUNT * TICK_MS,
        );
      }, TICK_MS);
    },
    cancel: stop,
  });

  request.signal.addEventListener("abort", stop, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform guards against compression layers buffering small chunks.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";
import {
  parseRetryDelayMs,
  postWithRetry,
  type ProviderRequest,
} from "@/lib/providers/http";
import { readSseData, sseDataOf, splitSseEvents } from "@/lib/providers/sse";
import {
  instantPolicy,
  jsonResponse,
  sseResponse,
  stubFetch,
} from "./helpers/provider-mocks";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllGlobals());

function request(overrides: Partial<ProviderRequest> = {}): {
  req: ProviderRequest;
  waits: number[];
} {
  const { policy, waits } = instantPolicy();
  return {
    waits,
    req: {
      provider: "gemini",
      url: "https://example.test/x",
      headers: {},
      body: "{}",
      timeoutMs: 5_000,
      policy,
      ...overrides,
    },
  };
}

describe("postWithRetry", () => {
  it("backs off exponentially (with jitter) when the provider gives no hint", async () => {
    stubFetch(() => jsonResponse(503, {}));
    const { req, waits } = request();
    await expect(postWithRetry(req)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
    expect(waits[0]).toBeLessThan(1501);
    expect(waits[1]).toBeGreaterThanOrEqual(2000);
    expect(waits[1]).toBeLessThan(2501);
  });

  it("gives up without sleeping when computed backoff exceeds maxWaitMs", async () => {
    const { calls } = stubFetch(() => jsonResponse(503, {}));
    const { policy, waits } = instantPolicy({ maxWaitMs: 500 });
    await expect(postWithRetry(request({ policy }).req)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("does not retry when maxRetries is 0", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse(429, {}, { "retry-after": "0" }),
    );
    const { policy } = instantPolicy({ maxRetries: 0 });
    await expect(postWithRetry(request({ policy }).req)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(calls).toHaveLength(1);
  });

  it("returns the successful Response with its body unread", async () => {
    stubFetch(() => sseResponse(["data: 1\n\n"]));
    const response = await postWithRetry(request().req);
    expect(response.bodyUsed).toBe(false);
  });

  it("attaches a timeout signal to every attempt", async () => {
    const { calls } = stubFetch((_c, i) =>
      i === 0
        ? jsonResponse(503, {}, { "retry-after": "0" })
        : jsonResponse(200, {}),
    );
    await postWithRetry(request().req);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.init.signal).toBeTruthy();
  });

  it("parses Google retry delays", () => {
    expect(parseRetryDelayMs("12s")).toBe(12_000);
    expect(parseRetryDelayMs("0.5s")).toBe(500);
    expect(parseRetryDelayMs("soon")).toBeNull();
  });
});

describe("SSE parsing (carried over from the spike)", () => {
  it("splits complete events and keeps the unfinished tail", () => {
    const { events, rest } = splitSseEvents(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"',
    );
    expect(events).toHaveLength(2);
    expect(rest).toBe('data: {"c"');
  });

  it("handles CRLF and returns null for blocks without data lines", () => {
    const { events } = splitSseEvents("data: one\r\n\r\ndata: two\r\n\r\n");
    expect(events.map(sseDataOf)).toEqual(["one", "two"]);
    expect(sseDataOf(": keep-alive")).toBeNull();
  });

  it("joins multi-line data fields", async () => {
    const out: string[] = [];
    const body = sseResponse(["data: a\ndata: b\n\n"]).body;
    if (!body) throw new Error("no body");
    for await (const data of readSseData(body)) out.push(data);
    expect(out).toEqual(["a\nb"]);
  });
});

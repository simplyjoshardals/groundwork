import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingEnvError } from "@/lib/providers/env";
import {
  BadRequestError,
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";
import {
  createFailoverLlmProvider,
  shouldFailOver,
} from "@/lib/providers/failover-llm";
import type {
  LlmProvider,
  LlmStreamEvent,
  LlmStreamOptions,
} from "@/lib/providers/types";
import { collect } from "./helpers/provider-mocks";

vi.mock("server-only", () => ({}));

const MESSAGES = [{ role: "user", content: "Q" }] as const;
const STOP: LlmStreamEvent = { type: "finish", reason: "stop" };

type Script = (options?: LlmStreamOptions) => AsyncGenerator<LlmStreamEvent>;

function fake(model: string, script: Script) {
  const stream = vi.fn((_m: unknown, options?: LlmStreamOptions) =>
    script(options),
  );
  const provider: LlmProvider = { model, stream };
  return { provider, stream };
}

const ok = (text: string): Script =>
  async function* () {
    yield { type: "text", text };
    yield STOP;
  };
const failing = (error: Error): Script =>
  async function* () {
    yield* [];
    throw error;
  };

const rateLimit = () =>
  new RateLimitError("limited", { provider: "gemini", status: 429 });
const down = () =>
  new ProviderUnavailableError("down", { provider: "gemini", status: 503 });
const badRequest = (status: number) =>
  new BadRequestError("rejected", { provider: "gemini", status });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("shouldFailOver", () => {
  it("accepts rate limits, outages, auth failures and a missing model", () => {
    expect(shouldFailOver(rateLimit())).toBe(true);
    expect(shouldFailOver(down())).toBe(true);
    expect(shouldFailOver(badRequest(401))).toBe(true);
    expect(shouldFailOver(badRequest(403))).toBe(true);
    expect(shouldFailOver(badRequest(404))).toBe(true);
  });

  it("rejects other request errors and everything that is not a provider error", () => {
    expect(shouldFailOver(badRequest(400))).toBe(false);
    expect(shouldFailOver(new Error("boom"))).toBe(false);
    expect(shouldFailOver(new MissingEnvError("X"))).toBe(false);
    expect(shouldFailOver("text")).toBe(false);
  });
});

describe("createFailoverLlmProvider", () => {
  it("uses only the primary when it succeeds", async () => {
    const primary = fake("p", ok("primary answer"));
    const fallback = fake("f", ok("fallback answer"));
    const events = await collect(
      createFailoverLlmProvider(primary.provider, fallback.provider).stream(
        MESSAGES,
      ),
    );
    expect(events[0]).toEqual({ type: "text", text: "primary answer" });
    expect(fallback.stream).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("answers from the fallback when the primary is rate limited (429)", async () => {
    const primary = fake("p", failing(rateLimit()));
    const fallback = fake("f", ok("fallback answer"));
    const events = await collect(
      createFailoverLlmProvider(primary.provider, fallback.provider).stream(
        MESSAGES,
      ),
    );
    expect(events).toEqual([{ type: "text", text: "fallback answer" }, STOP]);
    expect(fallback.stream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an outage", down],
    ["a rejected key", () => badRequest(401)],
    ["a retired model", () => badRequest(404)],
  ])("fails over on %s", async (_name, makeError) => {
    const fallback = fake("f", ok("fallback answer"));
    const events = await collect(
      createFailoverLlmProvider(
        fake("p", failing(makeError())).provider,
        fallback.provider,
      ).stream(MESSAGES),
    );
    expect(events[0]).toEqual({ type: "text", text: "fallback answer" });
  });

  it("logs which models are involved and the error, with no request content", async () => {
    const fallback = fake("fallback-model", ok("x"));
    await collect(
      createFailoverLlmProvider(
        fake("primary-model", failing(rateLimit())).provider,
        fallback.provider,
      ).stream([{ role: "user", content: "SECRET QUESTION TEXT" }]),
    );
    const line = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(line).toContain("primary-model");
    expect(line).toContain("fallback-model");
    expect(line).toContain("RateLimitError");
    expect(line).not.toContain("SECRET QUESTION TEXT");
  });

  it.each([
    ["a plain 400", () => badRequest(400)],
    ["an unexpected error", () => new Error("boom")],
    ["a missing key", () => new MissingEnvError("GEMINI_API_KEY")],
  ])("does not fail over on %s", async (_name, makeError) => {
    const error = makeError();
    const fallback = fake("f", ok("fallback answer"));
    await expect(
      collect(
        createFailoverLlmProvider(
          fake("p", failing(error)).provider,
          fallback.provider,
        ).stream(MESSAGES),
      ),
    ).rejects.toBe(error);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it("does not switch once the primary has sent text: the error is rethrown", async () => {
    const error = down();
    const primary = fake("p", async function* () {
      yield { type: "text", text: "partial" };
      throw error;
    });
    const fallback = fake("f", ok("fallback answer"));
    const seen: LlmStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of createFailoverLlmProvider(
          primary.provider,
          fallback.provider,
        ).stream(MESSAGES)) {
          seen.push(event);
        }
      })(),
    ).rejects.toBe(error);
    expect(seen).toEqual([{ type: "text", text: "partial" }]);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it("does not fail over on a blocked finish", async () => {
    const primary = fake("p", async function* () {
      yield { type: "finish", reason: "blocked" };
    });
    const fallback = fake("f", ok("fallback answer"));
    const events = await collect(
      createFailoverLlmProvider(primary.provider, fallback.provider).stream(
        MESSAGES,
      ),
    );
    expect(events).toEqual([{ type: "finish", reason: "blocked" }]);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it("does not fail over when the caller aborted", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const primary = fake("p", async function* () {
      yield* [];
      controller.abort();
      throw abortError;
    });
    const fallback = fake("f", ok("fallback answer"));
    await expect(
      collect(
        createFailoverLlmProvider(primary.provider, fallback.provider).stream(
          MESSAGES,
          { signal: controller.signal },
        ),
      ),
    ).rejects.toBe(abortError);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it("throws the fallback's error when both fail", async () => {
    const second = rateLimit();
    const events: LlmStreamEvent[] = [];
    const run = async () => {
      for await (const event of createFailoverLlmProvider(
        fake("p", failing(down())).provider,
        fake("f", failing(second)).provider,
      ).stream(MESSAGES)) {
        events.push(event);
      }
    };
    await expect(run()).rejects.toBe(second);
    expect(events).toEqual([]);
  });

  it("passes the options (signal) to the fallback and reports the primary's model", async () => {
    const controller = new AbortController();
    const primary = fake("primary-model", failing(down()));
    const fallback = fake("f", ok("x"));
    const provider = createFailoverLlmProvider(
      primary.provider,
      fallback.provider,
    );
    expect(provider.model).toBe("primary-model");
    await collect(
      provider.stream(MESSAGES, {
        signal: controller.signal,
        maxOutputTokens: 50,
      }),
    );
    expect(fallback.stream).toHaveBeenCalledWith(MESSAGES, {
      signal: controller.signal,
      maxOutputTokens: 50,
    });
  });

  it("closes the primary's stream when the consumer stops early", async () => {
    let cleanedUp = false;
    const primary = fake("p", async function* () {
      try {
        yield { type: "text", text: "a" };
        yield { type: "text", text: "b" };
      } finally {
        cleanedUp = true;
      }
    });
    const iterator = createFailoverLlmProvider(
      primary.provider,
      fake("f", ok("x")).provider,
    )
      .stream(MESSAGES)
      [Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(cleanedUp).toBe(true);
  });
});

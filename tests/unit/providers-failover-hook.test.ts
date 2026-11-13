import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFailoverLlmProvider } from "@/lib/providers/failover-llm";
import { BadRequestError, RateLimitError } from "@/lib/providers/errors";
import type { LlmProvider, LlmStreamEvent } from "@/lib/providers/types";

const messages = [{ role: "user", content: "hi" }] as const;

function working(model: string): LlmProvider {
  return {
    model,
    async *stream() {
      yield { type: "text", text: `from ${model}` };
      yield { type: "finish", reason: "stop" };
    },
  };
}

function failing(model: string, error: Error): LlmProvider {
  return {
    model,
    // eslint-disable-next-line require-yield
    async *stream() {
      throw error;
    },
  };
}

async function drain(provider: LlmProvider): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of provider.stream(messages)) events.push(event);
  return events;
}

describe("createFailoverLlmProvider: onFailover hook (Task 5.10)", () => {
  it("is called once, with both model ids, when the fallback takes over", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onFailover = vi.fn();
    const error = new RateLimitError("limited", {
      provider: "gemini",
      status: 429,
    });
    const provider = createFailoverLlmProvider(
      failing("primary-model", error),
      working("fallback-model"),
      { onFailover },
    );
    const events = await drain(provider);
    expect(events[0]).toEqual({ type: "text", text: "from fallback-model" });
    expect(onFailover).toHaveBeenCalledTimes(1);
    expect(onFailover).toHaveBeenCalledWith({
      from: "primary-model",
      to: "fallback-model",
      error,
    });
    warn.mockRestore();
  });

  it("is not called when the primary answers", async () => {
    const onFailover = vi.fn();
    await drain(
      createFailoverLlmProvider(working("p"), working("f"), { onFailover }),
    );
    expect(onFailover).not.toHaveBeenCalled();
  });

  it("is not called for an error that does not fail over", async () => {
    const onFailover = vi.fn();
    const provider = createFailoverLlmProvider(
      failing("p", new BadRequestError("bad", { provider: "gemini", status: 400 })),
      working("f"),
      { onFailover },
    );
    await expect(drain(provider)).rejects.toBeInstanceOf(BadRequestError);
    expect(onFailover).not.toHaveBeenCalled();
  });

  it("does not let a throwing hook stop the failover", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = createFailoverLlmProvider(
      failing("p", new RateLimitError("limited", { provider: "gemini", status: 429 })),
      working("f"),
      {
        onFailover: () => {
          throw new Error("hook broke");
        },
      },
    );
    const events = await drain(provider);
    expect(events[0]).toEqual({ type: "text", text: "from f" });
    expect(err).toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });
});

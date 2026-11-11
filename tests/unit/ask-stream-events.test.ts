import { describe, expect, it } from "vitest";
import {
  encodeStreamEvent,
  isTerminalStreamEvent,
  parseStreamEvent,
} from "@/lib/ask-stream/events";
import { StreamProtocolError } from "@/lib/ask-stream/errors";
import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";

const SOURCE: StreamSource = {
  marker: 1,
  documentId: "7d1c0a52-6f43-4b0e-9a55-2f1f5f2c9a10",
  chunkId: 42,
  documentTitle: "Employee Handbook",
  page: 4,
  snippet: "Employees may work remotely up to three days a week.",
};

const EVENTS: AskStreamEvent[] = [
  { type: "sources", sources: [SOURCE, { ...SOURCE, marker: 2, page: 5 }] },
  { type: "sources", sources: [] },
  { type: "token", text: "Three days [1]." },
  { type: "token", text: "" },
  { type: "done", citations: [1, 2], invalidCitations: [9] },
  { type: "done", citations: [], invalidCitations: [] },
  { type: "not_found" },
  { type: "not_found", closest: [SOURCE] },
  { type: "not_found", closest: [] },
  { type: "limit", scope: "user" },
  { type: "limit", scope: "global" },
  {
    type: "limit",
    scope: "user",
    reason: "user_limit",
    resetsAt: "2026-11-10T00:00:00.000Z",
  },
  {
    type: "limit",
    scope: "user",
    reason: "cooldown",
    resetsAt: "2026-11-10T00:00:00.000Z",
  },
  {
    type: "limit",
    scope: "global",
    reason: "global_limit",
    resetsAt: "2026-11-10T00:00:00.000Z",
  },
  {
    type: "done",
    citations: [1],
    invalidCitations: [],
    usage: {
      remaining: 17,
      dailyLimit: 20,
      resetsAt: "2026-11-11T00:00:00.000Z",
    },
  },
  {
    type: "not_found",
    closest: [SOURCE],
    usage: {
      remaining: 0,
      dailyLimit: 20,
      resetsAt: "2026-11-11T00:00:00.000Z",
    },
  },
  { type: "error", code: "interrupted", message: "The answer was cut off." },
];

describe("encodeStreamEvent", () => {
  it("produces one `data:` line terminated by a blank line", () => {
    const frame = encodeStreamEvent({ type: "token", text: "hi" });
    expect(frame).toBe('data: {"type":"token","text":"hi"}\n\n');
  });

  it("keeps the type inside the JSON and uses no `event:` field", () => {
    const frame = encodeStreamEvent({ type: "limit", scope: "global" });
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame).not.toMatch(/^event:/m);
    expect(JSON.parse(frame.slice(6))).toEqual({
      type: "limit",
      scope: "global",
    });
  });

  it("escapes newlines in text, so a frame has exactly one line break pair", () => {
    const frame = encodeStreamEvent({
      type: "token",
      text: "line one\r\nline two\n\nline three",
    });
    expect(frame.slice(0, -2)).not.toMatch(/[\r\n]/);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it.each(EVENTS)("round-trips through parseStreamEvent: %j", (event) => {
    const frame = encodeStreamEvent(event);
    const payload: unknown = JSON.parse(frame.slice("data: ".length));
    expect(parseStreamEvent(payload)).toEqual(event);
  });

  it("round-trips text with newlines, quotes, emoji and line separators", () => {
    const text = 'a\nb\r\n"c" 😀 é \u2028 \u2029 \\';
    const frame = encodeStreamEvent({ type: "token", text });
    const parsed = parseStreamEvent(JSON.parse(frame.slice(6)));
    expect(parsed).toEqual({ type: "token", text });
  });
});

describe("parseStreamEvent: valid events", () => {
  it.each(EVENTS)("accepts %j", (event) => {
    expect(parseStreamEvent(event)).toEqual(event);
  });

  it("omits `closest` entirely when a not_found event has none", () => {
    const parsed = parseStreamEvent({ type: "not_found" });
    expect(parsed).toEqual({ type: "not_found" });
    expect(parsed).not.toHaveProperty("closest");
  });

  it("treats `closest: undefined` like an absent field", () => {
    expect(parseStreamEvent({ type: "not_found", closest: undefined })).toEqual(
      { type: "not_found" },
    );
  });

  it("ignores unknown fields on events and on sources (additive growth)", () => {
    const parsed = parseStreamEvent({
      type: "sources",
      extra: true,
      sources: [{ ...SOURCE, charStart: 10, charEnd: 40 }],
    });
    expect(parsed).toEqual({ type: "sources", sources: [SOURCE] });
    if (parsed?.type !== "sources") throw new Error("expected sources");
    expect(parsed.sources[0]).not.toHaveProperty("charStart");
  });

  it("accepts out-of-range markers in done.invalidCitations, like 0 or 9", () => {
    expect(
      parseStreamEvent({
        type: "done",
        citations: [1],
        invalidCitations: [0, 9],
      }),
    ).toEqual({ type: "done", citations: [1], invalidCitations: [0, 9] });
  });
});

describe("parseStreamEvent: unknown event types", () => {
  it("returns null for an unknown type, whatever else it carries", () => {
    expect(parseStreamEvent({ type: "tick", seq: 1 })).toBeNull();
    expect(
      parseStreamEvent({ type: "metrics", sources: "garbage" }),
    ).toBeNull();
    expect(parseStreamEvent({ type: "" })).toBeNull();
  });

  it("is case-sensitive: `Token` is unknown, not a token", () => {
    expect(parseStreamEvent({ type: "Token", text: "x" })).toBeNull();
  });

  it("does not mistake object prototype names for known types", () => {
    expect(parseStreamEvent({ type: "constructor" })).toBeNull();
    expect(parseStreamEvent({ type: "toString" })).toBeNull();
  });
});

describe("parseStreamEvent: malformed payloads throw StreamProtocolError", () => {
  const goodSource = SOURCE;

  const cases: [string, unknown][] = [
    ["null", null],
    ["a string", "token"],
    ["a number", 3],
    ["an array", [{ type: "token", text: "x" }]],
    ["no type", { text: "x" }],
    ["a non-string type", { type: 7 }],
    ["token without text", { type: "token" }],
    ["token with numeric text", { type: "token", text: 5 }],
    ["token with null text", { type: "token", text: null }],
    ["sources without sources", { type: "sources" }],
    ["sources that is not an array", { type: "sources", sources: {} }],
    ["a source that is not an object", { type: "sources", sources: ["x"] }],
    [
      "a source with marker 0",
      { type: "sources", sources: [{ ...goodSource, marker: 0 }] },
    ],
    [
      "a source with a fractional marker",
      { type: "sources", sources: [{ ...goodSource, marker: 1.5 }] },
    ],
    [
      "a source with a string marker",
      { type: "sources", sources: [{ ...goodSource, marker: "1" }] },
    ],
    [
      "a source with page 0",
      { type: "sources", sources: [{ ...goodSource, page: 0 }] },
    ],
    [
      "a source with a negative page",
      { type: "sources", sources: [{ ...goodSource, page: -2 }] },
    ],
    [
      "a source without documentId",
      {
        type: "sources",
        sources: [{ ...goodSource, documentId: undefined }],
      },
    ],
    [
      "a source without chunkId",
      { type: "sources", sources: [{ ...goodSource, chunkId: undefined }] },
    ],
    [
      "a source with a zero chunkId",
      { type: "sources", sources: [{ ...goodSource, chunkId: 0 }] },
    ],
    [
      "a source with a string chunkId",
      { type: "sources", sources: [{ ...goodSource, chunkId: "42" }] },
    ],
    [
      "a source with a numeric documentTitle",
      { type: "sources", sources: [{ ...goodSource, documentTitle: 4 }] },
    ],
    [
      "a source without a snippet",
      { type: "sources", sources: [{ ...goodSource, snippet: undefined }] },
    ],
    ["done without citations", { type: "done", invalidCitations: [] }],
    ["done without invalidCitations", { type: "done", citations: [] }],
    [
      "done with non-integer citations",
      { type: "done", citations: [1.5], invalidCitations: [] },
    ],
    [
      "done with string citations",
      { type: "done", citations: ["1"], invalidCitations: [] },
    ],
    [
      "done with a non-array invalidCitations",
      { type: "done", citations: [], invalidCitations: 3 },
    ],
    ["not_found with null closest", { type: "not_found", closest: null }],
    ["not_found with a non-array closest", { type: "not_found", closest: {} }],
    [
      "not_found with a bad closest entry",
      { type: "not_found", closest: [{ ...goodSource, page: "1" }] },
    ],
    ["limit without scope", { type: "limit" }],
    ["limit with an unknown scope", { type: "limit", scope: "team" }],
    [
      "limit with an unknown reason",
      { type: "limit", scope: "user", reason: "vip" },
    ],
    [
      "limit with a prototype name as reason",
      { type: "limit", scope: "user", reason: "toString" },
    ],
    [
      "limit with a non-string reason",
      { type: "limit", scope: "user", reason: 1 },
    ],
    [
      "limit with a non-string resetsAt",
      { type: "limit", scope: "user", resetsAt: 5 },
    ],
    ["error without code", { type: "error", message: "x" }],
    [
      "error with an unknown code",
      { type: "error", code: "nope", message: "x" },
    ],
    [
      "error with a prototype name as code",
      { type: "error", code: "toString", message: "x" },
    ],
    ["error without message", { type: "error", code: "internal_error" }],
    [
      "error with a non-string message",
      { type: "error", code: "internal_error", message: 1 },
    ],
  ];

  it.each(cases)("%s", (_label, payload) => {
    expect(() => parseStreamEvent(payload)).toThrow(StreamProtocolError);
  });

  it("names the event and field but never echoes the payload", () => {
    const secret = "do-not-leak-this";
    expect(() =>
      parseStreamEvent({ type: "limit", scope: secret }),
    ).toThrowError(/"limit".*"scope"/);
    try {
      parseStreamEvent({ type: "limit", scope: secret });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe("isTerminalStreamEvent", () => {
  it("is true for done, not_found, limit and error", () => {
    const terminal = EVENTS.filter(isTerminalStreamEvent).map((e) => e.type);
    expect(new Set(terminal)).toEqual(
      new Set(["done", "not_found", "limit", "error"]),
    );
  });

  it("is false for sources and token", () => {
    expect(isTerminalStreamEvent({ type: "sources", sources: [] })).toBe(false);
    expect(isTerminalStreamEvent({ type: "token", text: "x" })).toBe(false);
  });
});

describe("limit event: reason and resetsAt (Task 5.2)", () => {
  it("accepts the older shape and leaves reason and resetsAt absent", () => {
    const parsed = parseStreamEvent({ type: "limit", scope: "user" });
    expect(parsed).toEqual({ type: "limit", scope: "user" });
    expect(parsed).not.toHaveProperty("reason");
    expect(parsed).not.toHaveProperty("resetsAt");
  });

  it("ignores unknown extra fields", () => {
    expect(
      parseStreamEvent({
        type: "limit",
        scope: "global",
        reason: "global_limit",
        resetsAt: "2026-11-10T00:00:00.000Z",
        future: true,
      }),
    ).toEqual({
      type: "limit",
      scope: "global",
      reason: "global_limit",
      resetsAt: "2026-11-10T00:00:00.000Z",
    });
  });

  it("names the field but never echoes a bad reason", () => {
    const secret = "do-not-leak-this";
    expect(() =>
      parseStreamEvent({ type: "limit", scope: "user", reason: secret }),
    ).toThrowError(/"limit".*"reason"/);
    try {
      parseStreamEvent({ type: "limit", scope: "user", reason: secret });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe("done and not_found: usage (Task 5.3)", () => {
  const usage = {
    remaining: 3,
    dailyLimit: 20,
    resetsAt: "2026-11-11T00:00:00.000Z",
  };
  const done = { type: "done", citations: [], invalidCitations: [] };

  it("leaves usage absent when the server sends none", () => {
    expect(parseStreamEvent(done)).not.toHaveProperty("usage");
    expect(parseStreamEvent({ type: "not_found" })).not.toHaveProperty("usage");
    expect(parseStreamEvent({ ...done, usage: undefined })).not.toHaveProperty(
      "usage",
    );
  });

  it("keeps closest and usage together on not_found", () => {
    expect(
      parseStreamEvent({ type: "not_found", closest: [SOURCE], usage }),
    ).toEqual({ type: "not_found", closest: [SOURCE], usage });
  });

  it("rebuilds usage field by field, dropping unknown extras", () => {
    expect(
      parseStreamEvent({ ...done, usage: { ...usage, extra: 1 } }),
    ).toEqual({ ...done, usage });
  });

  it.each([
    ["not an object", "x"],
    ["null", null],
    ["an array", []],
    ["a fractional remaining", { ...usage, remaining: 1.5 }],
    ["a negative remaining", { ...usage, remaining: -1 }],
    ["a string remaining", { ...usage, remaining: "3" }],
    ["a missing dailyLimit", { remaining: 3, resetsAt: usage.resetsAt }],
    ["a negative dailyLimit", { ...usage, dailyLimit: -20 }],
    ["a non-string resetsAt", { ...usage, resetsAt: 0 }],
    ["an unreadable resetsAt", { ...usage, resetsAt: "not-a-date" }],
  ])("rejects usage that is %s", (_name, bad) => {
    expect(() => parseStreamEvent({ ...done, usage: bad })).toThrowError(
      StreamProtocolError,
    );
    expect(() =>
      parseStreamEvent({ type: "not_found", usage: bad }),
    ).toThrowError(StreamProtocolError);
  });

  it("names the field but never echoes the bad value", () => {
    const secret = "do-not-leak-this";
    expect(() =>
      parseStreamEvent({ ...done, usage: { ...usage, resetsAt: secret } }),
    ).toThrowError(/"done".*"usage\.resetsAt"/);
    try {
      parseStreamEvent({ ...done, usage: { ...usage, resetsAt: secret } });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

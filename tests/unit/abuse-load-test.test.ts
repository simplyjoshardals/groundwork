import { describe, expect, it } from "vitest";
import {
  analyzeRun,
  classifyResponse,
  percentile,
  suggestGlobalCap,
  type CallCounts,
  type Outcome,
  type Phase,
  type RequestResult,
} from "@/scripts/load-test/analyze";

const frame = (event: Record<string, unknown>) =>
  `data: ${JSON.stringify(event)}\n\n`;

function result(outcome: Outcome, ms = 50, phase: Phase = "burst") {
  return { phase, outcome, ms } satisfies RequestResult;
}

const answered: Outcome = { kind: "answered" };
const globalLimit: Outcome = { kind: "limit", reason: "global_limit" };

/** A clean run: 2 cooldown requests (1 allowed) plus a burst; cap 3 in total. */
function cleanRun() {
  const results: RequestResult[] = [
    result(answered, 900, "cooldown"),
    result({ kind: "limit", reason: "cooldown" }, 30, "cooldown"),
    result({ kind: "limit", reason: "cooldown" }, 35, "cooldown"),
    result(answered, 1200),
    result({ kind: "not_found" }, 400),
    result(globalLimit, 40),
    result(globalLimit, 45),
  ];
  const calls: CallCounts = {
    consume: 7,
    refund: 0,
    embed: 3,
    llm: 2,
    groq: 0,
  };
  return {
    results,
    calls,
    globalBefore: 10,
    globalAfter: 13,
    cap: 3,
    maxLimitMs: 2000,
  };
}

describe("classifyResponse", () => {
  it("reads the terminal frame of a stream", () => {
    const done = frame({ type: "token", text: "Hi" }) + frame({ type: "done" });
    expect(classifyResponse(200, done)).toEqual({ kind: "answered" });
    expect(classifyResponse(200, frame({ type: "not_found" }))).toEqual({
      kind: "not_found",
    });
    expect(
      classifyResponse(
        200,
        frame({ type: "limit", scope: "global", reason: "global_limit" }),
      ),
    ).toEqual({ kind: "limit", reason: "global_limit" });
    expect(
      classifyResponse(200, frame({ type: "error", code: "llm_unavailable" })),
    ).toEqual({ kind: "stream_error", code: "llm_unavailable" });
  });

  it("treats a body with no terminal frame as a stream error", () => {
    expect(classifyResponse(200, frame({ type: "token", text: "x" }))).toEqual({
      kind: "stream_error",
      code: "no_terminal",
    });
    expect(classifyResponse(200, "data: {broken")).toEqual({
      kind: "stream_error",
      code: "no_terminal",
    });
  });

  it("maps a non-200 status to an HTTP error", () => {
    expect(classifyResponse(503, "{}")).toEqual({
      kind: "http_error",
      status: 503,
    });
  });
});

describe("percentile", () => {
  it("uses the nearest rank and handles an empty list", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe("analyzeRun", () => {
  it("passes a clean run", () => {
    const analysis = analyzeRun(cleanRun());
    const failed = analysis.checks.filter((c) => !c.pass);
    expect(failed).toEqual([]);
    expect(analysis.summary.spent).toBe(3);
  });

  it("fails when the counter moved by more than the spent units", () => {
    const run = { ...cleanRun(), globalAfter: 14 };
    const failed = analyzeRun(run).checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.name)).toContain(
      "Global counter matches spent units",
    );
  });

  it("accounts for refunds", () => {
    const run = cleanRun();
    // One spent unit refunded: the counter moves by 2, not 3.
    const refunded = {
      ...run,
      calls: { ...run.calls, refund: 1 },
      globalAfter: 12,
    };
    const checks = analyzeRun(refunded).checks;
    expect(
      checks.find((c) => c.name === "Global counter matches spent units")?.pass,
    ).toBe(true);
    // ...but then the cap did not trip at exactly the configured number.
    expect(
      checks.find((c) => c.name.startsWith("Global cap tripped"))?.pass,
    ).toBe(false);
  });

  it("fails on a 5xx and skips the counter check", () => {
    const run = cleanRun();
    const broken = {
      ...run,
      results: [...run.results, result({ kind: "http_error", status: 503 })],
      calls: { ...run.calls, consume: 8 },
    };
    const checks = analyzeRun(broken).checks;
    expect(checks.find((c) => c.name.startsWith("No 5xx"))?.pass).toBe(false);
    expect(
      checks.find((c) => c.name === "Global counter matches spent units")
        ?.detail,
    ).toContain("skipped");
  });

  it("fails when a blocked request called a provider", () => {
    const run = cleanRun();
    const leaked = { ...run, calls: { ...run.calls, embed: 4 } };
    const failed = analyzeRun(leaked).checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.name)).toEqual([
      "Embedding calls equal spent units",
    ]);
  });

  it("fails when an LLM call was made for a refusal or a block", () => {
    const run = cleanRun();
    const leaked = { ...run, calls: { ...run.calls, llm: 3 } };
    const failed = analyzeRun(leaked).checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.name)).toEqual([
      "LLM calls equal answered questions",
    ]);
  });

  it("counts a Groq failover as an LLM call", () => {
    const run = cleanRun();
    const failover = { ...run, calls: { ...run.calls, llm: 1, groq: 1 } };
    expect(analyzeRun(failover).checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("fails when limit responses are slow", () => {
    const run = cleanRun();
    const slow = {
      ...run,
      results: run.results.map((r) =>
        r.outcome.kind === "limit" ? { ...r, ms: 5000 } : r,
      ),
    };
    expect(
      analyzeRun(slow).checks.find(
        (c) => c.name === "Blocked requests answer fast",
      )?.pass,
    ).toBe(false);
  });

  it("fails when parallel requests from one user all get through", () => {
    const run = cleanRun();
    const results = run.results.map((r) =>
      r.phase === "cooldown" ? { ...r, outcome: answered } : r,
    );
    const checks = analyzeRun({ ...run, results }).checks;
    expect(
      checks.find((c) => c.name.startsWith("Cooldown lets one"))?.pass,
    ).toBe(false);
  });
});

describe("suggestGlobalCap", () => {
  it("rounds down and rejects nonsense", () => {
    expect(suggestGlobalCap(500, 0.5)).toBe(250);
    expect(suggestGlobalCap(333, 0.5)).toBe(166);
    expect(suggestGlobalCap(0, 0.5)).toBe(0);
    expect(suggestGlobalCap(500, 1.5)).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { EvalEntry } from "@/eval/dataset";
import { buildReport, renderJson, renderMarkdown } from "@/eval/report";
import {
  isRetryable,
  runRetrievalEval,
  withBackoff,
  type BackoffOptions,
} from "@/eval/run-retrieval";
import {
  errorResult,
  round6,
  scoreQuestion,
  summarize,
  type EvalPassage,
} from "@/eval/score-retrieval";
import {
  BadRequestError,
  ProviderUnavailableError,
  RateLimitError,
} from "@/lib/providers/errors";

function entry(overrides: Partial<EvalEntry> = {}): EvalEntry {
  return {
    id: "Q01",
    category: "direct",
    question: "How many days?",
    answerable: true,
    document: "handbook",
    factIds: ["F01"],
    expectedFacts: ["26 days"],
    expectedPages: [3],
    forbiddenSubstrings: [],
    ...overrides,
  };
}

const unanswerable = (id = "Q16"): EvalEntry =>
  entry({
    id,
    category: "unanswerable",
    answerable: false,
    document: null,
    factIds: [],
    expectedFacts: [],
    expectedPages: [],
  });

const p = (
  doc: EvalPassage["doc"],
  page: number,
  similarity: number,
): EvalPassage => ({ doc, page, similarity });

describe("scoreQuestion", () => {
  it("is a hit when a chunk of the own document sits on an expected page", () => {
    const result = scoreQuestion(entry(), [
      p("handbook", 7, 0.8),
      p("handbook", 3, 0.7),
    ]);
    expect(result.hit).toBe(true);
    expect(result.allPagesHit).toBe(true);
    expect(result.top1Similarity).toBe(0.8);
    expect(result.topK.map((x) => x.rank)).toEqual([1, 2]);
  });

  it("does not count a FAQ chunk on the expected page number", () => {
    const result = scoreQuestion(entry(), [p("faq", 3, 0.9)]);
    expect(result.hit).toBe(false);
  });

  it("separates hit (any expected page) from allPagesHit (every expected page)", () => {
    const multi = entry({ expectedPages: [5, 10] });
    const one = scoreQuestion(multi, [p("handbook", 5, 0.8)]);
    expect([one.hit, one.allPagesHit]).toEqual([true, false]);
    const both = scoreQuestion(multi, [
      p("handbook", 5, 0.8),
      p("handbook", 10, 0.7),
    ]);
    expect([both.hit, both.allPagesHit]).toEqual([true, true]);
  });

  it("scores the injection case against the memo only", () => {
    const memo = entry({
      category: "injection",
      document: "injection-memo",
      factIds: [],
      expectedPages: [1],
      forbiddenSubstrings: ["CANARY"],
    });
    expect(scoreQuestion(memo, [p("handbook", 1, 0.9)]).hit).toBe(false);
    expect(scoreQuestion(memo, [p("injection-memo", 1, 0.5)]).hit).toBe(true);
  });

  it("gives an unanswerable question a similarity but no hit", () => {
    const result = scoreQuestion(unanswerable(), [p("handbook", 2, 0.55)]);
    expect(result.hit).toBeNull();
    expect(result.allPagesHit).toBeNull();
    expect(result.top1Similarity).toBe(0.55);
  });

  it("handles an empty result and rounds similarity to 6 decimals", () => {
    const empty = scoreQuestion(entry(), []);
    expect(empty.hit).toBe(false);
    expect(empty.top1Similarity).toBeNull();
    expect(round6(0.123456789)).toBe(0.123457);
    expect(
      scoreQuestion(entry(), [p("handbook", 3, 0.123456789)]).top1Similarity,
    ).toBe(0.123457);
  });
});

describe("summarize", () => {
  const results = [
    scoreQuestion(entry({ id: "Q01" }), [p("handbook", 3, 0.8)]),
    scoreQuestion(entry({ id: "Q02", category: "paraphrase" }), [
      p("handbook", 9, 0.6),
    ]),
    scoreQuestion(unanswerable("Q16"), [p("handbook", 1, 0.5)]),
    errorResult(entry({ id: "Q03" }), "RateLimitError: slow down"),
  ];

  it("computes hit@k over answerable questions that were retrieved", () => {
    const summary = summarize(results, 6);
    expect(summary).toMatchObject({
      k: 6,
      total: 4,
      errors: 1,
      answerable: 3,
      answerableScored: 2,
      hits: 1,
      hitAtK: 0.5,
    });
    expect(summary.byCategory.find((c) => c.category === "direct")).toEqual({
      category: "direct",
      scored: 1,
      hits: 1,
    });
    expect(summary.byCategory.some((c) => c.category === "unanswerable")).toBe(
      false,
    );
  });

  it("reports top-1 similarity stats separately for answerable and unanswerable", () => {
    const summary = summarize(results, 6);
    expect(summary.answerableTop1).toEqual({
      count: 2,
      min: 0.6,
      mean: 0.7,
      max: 0.8,
    });
    expect(summary.unanswerableTop1).toEqual({
      count: 1,
      min: 0.5,
      mean: 0.5,
      max: 0.5,
    });
  });

  it("returns null rates when nothing was scored", () => {
    const summary = summarize([errorResult(entry(), "x")], 6);
    expect(summary.hitAtK).toBeNull();
    expect(summary.answerableTop1.mean).toBeNull();
  });
});

describe("report", () => {
  const meta = {
    label: "baseline",
    generatedAt: "2026-11-04T10:00:00.000Z",
    k: 6,
    embeddingModel: "gemini-embedding-2",
  };
  const results = [
    scoreQuestion(entry({ question: "Is a | pipe safe?" }), [
      p("handbook", 3, 0.8123456),
      p("faq", 1, 0.7),
    ]),
    scoreQuestion(unanswerable(), [p("handbook", 2, 0.5)]),
  ];

  it("gives the same hash for the same results regardless of the timestamp", () => {
    const a = buildReport(meta, results);
    const b = buildReport(
      { ...meta, generatedAt: "2027-01-01T00:00:00Z" },
      results,
    );
    expect(a.resultsHash).toBe(b.resultsHash);
    expect(a.resultsHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes the hash when a retrieved page changes", () => {
    const changed = [
      scoreQuestion(entry(), [p("handbook", 4, 0.8123456)]),
      results[1]!,
    ];
    expect(buildReport(meta, changed).resultsHash).not.toBe(
      buildReport(meta, results).resultsHash,
    );
  });

  it("renders JSON that round-trips", () => {
    const report = buildReport(meta, results);
    expect(JSON.parse(renderJson(report))).toEqual(report);
  });

  it("renders a Markdown table with hit and top-1 similarity per question", () => {
    const markdown = renderMarkdown(buildReport(meta, results));
    expect(markdown).toContain("**hit@6: 1/1 (100.0%)**");
    expect(markdown).toContain("| ID | Category | Question |");
    expect(markdown).toContain(
      "| Q01 | direct | Is a \\| pipe safe? | H3 | H3 F1 | 0.8123 | yes |",
    );
    expect(markdown).toContain("| Q16 | unanswerable |");
    expect(markdown).toContain("| none | H2 | 0.5000 | - |");
    expect(markdown).not.toContain("INCOMPLETE");
  });

  it("flags an incomplete run and shows the error", () => {
    const markdown = renderMarkdown(
      buildReport(meta, [errorResult(entry(), "RateLimitError: 429")]),
    );
    expect(markdown).toContain("INCOMPLETE");
    expect(markdown).toContain("| ERROR |");
    expect(markdown).toContain("RateLimitError: 429");
  });
});

function backoff(overrides: Partial<BackoffOptions> = {}) {
  const sleeps: number[] = [];
  const options: BackoffOptions = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1,
    ...overrides,
  };
  return { options, sleeps };
}

const rateLimit = (retryAfterMs: number | null = null) =>
  new RateLimitError("429", {
    provider: "gemini",
    status: 429,
    retryAfterMs,
  });

describe("withBackoff", () => {
  it("retries rate limits with doubling delays and then succeeds", async () => {
    const { options, sleeps } = backoff();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimit())
      .mockRejectedValueOnce(
        new ProviderUnavailableError("503", {
          provider: "gemini",
          status: 503,
        }),
      )
      .mockResolvedValue("ok");
    await expect(withBackoff(fn, options)).resolves.toBe("ok");
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("waits at least the provider's retry-after hint, capped at the maximum", async () => {
    const { options, sleeps } = backoff();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimit(5000))
      .mockRejectedValueOnce(rateLimit(999_999))
      .mockResolvedValue("ok");
    await withBackoff(fn, options);
    expect(sleeps).toEqual([5000, 10_000]);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    const { options, sleeps } = backoff({ maxRetries: 2 });
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(rateLimit());
    await expect(withBackoff(fn, options)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it("does not retry other errors", async () => {
    const { options, sleeps } = backoff();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("boom"));
    await expect(withBackoff(fn, options)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
    expect(isRetryable(new Error("x"))).toBe(false);
    expect(
      isRetryable(
        new BadRequestError("400", { provider: "gemini", status: 400 }),
      ),
    ).toBe(false);
  });
});

describe("runRetrievalEval", () => {
  it("runs questions in order, pauses between them and truncates to k", async () => {
    const { options, sleeps } = backoff();
    const seen: string[] = [];
    const results = await runRetrievalEval({
      entries: [entry({ id: "Q01" }), unanswerable("Q16")],
      k: 2,
      pauseMs: 250,
      backoff: options,
      retrieve: async (e) => {
        seen.push(e.id);
        return [
          p("handbook", 3, 0.9),
          p("handbook", 4, 0.8),
          p("handbook", 5, 0.7),
        ];
      },
    });
    expect(seen).toEqual(["Q01", "Q16"]);
    expect(sleeps).toEqual([250]);
    expect(results[0]?.topK).toHaveLength(2);
  });

  it("records a failed question as an error and keeps going", async () => {
    const { options } = backoff({ maxRetries: 0 });
    const results = await runRetrievalEval({
      entries: [entry({ id: "Q01" }), entry({ id: "Q02" })],
      k: 6,
      pauseMs: 0,
      backoff: options,
      retrieve: async (e) => {
        if (e.id === "Q01") throw rateLimit();
        return [p("handbook", 3, 0.9)];
      },
    });
    expect(results[0]).toMatchObject({ status: "error", hit: null });
    expect(results[0]?.error).toContain("RateLimitError");
    expect(results[1]).toMatchObject({ status: "ok", hit: true });
  });

  it("gives identical results on a second run over the same retrieval", async () => {
    const run = () =>
      runRetrievalEval({
        entries: [entry({ id: "Q01" }), unanswerable("Q16")],
        k: 6,
        pauseMs: 0,
        backoff: backoff().options,
        retrieve: async () => [p("handbook", 3, 0.8123456789)],
      });
    expect(await run()).toEqual(await run());
  });
});

import { describe, expect, it, vi } from "vitest";
import type { EvalEntry } from "@/eval/dataset";
import {
  buildAnswerReport,
  renderAnswersJson,
  renderAnswersMarkdown,
} from "@/eval/report-answers";
import { isTransientLlmFailure, runAnswerEval } from "@/eval/run-answers";
import type { BackoffOptions } from "@/eval/run-retrieval";
import {
  answerErrorResult,
  answerHasFact,
  normalizeForMatch,
  scoreAnswer,
  summarizeAnswers,
  type AskObservation,
} from "@/eval/score-answers";
import type { EvalPassage } from "@/eval/score-retrieval";
import type { AskStreamEvent } from "@/types/ask-stream";

function entry(overrides: Partial<EvalEntry> = {}): EvalEntry {
  return {
    id: "Q01",
    category: "direct",
    question: "How many days?",
    answerable: true,
    document: "handbook",
    factIds: ["F08"],
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

const memoEntry = (): EvalEntry =>
  entry({
    id: "Q15",
    category: "injection",
    document: "injection-memo",
    factIds: [],
    expectedFacts: ["11:45"],
    expectedPages: [1],
    forbiddenSubstrings: ["CANARY-7731"],
  });

const p = (
  doc: EvalPassage["doc"],
  page: number,
  similarity = 0.8,
): EvalPassage => ({ doc, page, similarity });

const answered = (text: string): AskStreamEvent[] => [
  { type: "sources", sources: [] },
  { type: "token", text },
  { type: "done", citations: [], invalidCitations: [] },
];
const refusedByModel: AskStreamEvent[] = [{ type: "not_found" }];

const observe = (
  passages: EvalPassage[],
  events: AskStreamEvent[],
  gate1Refused = false,
): AskObservation => ({ gate1Refused, passages, events });

const kinds = (result: { failures: { kind: string }[] }) =>
  result.failures.map((failure) => failure.kind);

describe("fact matching", () => {
  it("normalizes case, markers, thousands commas and whitespace", () => {
    expect(normalizeForMatch("The limit is $1,200 [1].")).toBe(
      "the limit is $1200.",
    );
    expect(normalizeForMatch("**26**  days")).toBe("26 days");
  });

  it("matches whole tokens only", () => {
    expect(answerHasFact("You get 26 days.", "26 days")).toBe(true);
    expect(answerHasFact("You get 126 days.", "26 days")).toBe(false);
    expect(answerHasFact("It is $1,200 per year [2].", "$1,200")).toBe(true);
    expect(answerHasFact("Up to 16 hours.", "6 hours")).toBe(false);
  });

  it("does not count a number written another way", () => {
    expect(answerHasFact("Tell them by 9:30.", "09:30")).toBe(false);
  });
});

describe("scoreAnswer", () => {
  it("scores a correct, cited answer with no failures", () => {
    const result = scoreAnswer(
      entry(),
      observe([p("handbook", 3)], answered("Full-time staff get 26 days [1].")),
    );
    expect(result).toMatchObject({
      status: "ok",
      outcome: "answered",
      hit: true,
      factMatch: true,
      citations: [1],
      citedCorrect: true,
      allCitationsCorrect: true,
      needsReview: false,
      failures: [],
    });
  });

  it("flags a citation to the wrong page and a retrieval miss", () => {
    const result = scoreAnswer(
      entry(),
      observe([p("handbook", 7)], answered("You get 26 days [1].")),
    );
    expect(kinds(result)).toEqual(["retrieval_miss", "wrong_citation"]);
    expect(result.needsReview).toBe(true);
  });

  it("does not accept a FAQ passage on the expected page number", () => {
    const result = scoreAnswer(
      entry(),
      observe([p("faq", 3)], answered("You get 26 days [1].")),
    );
    expect(result.citedCorrect).toBe(false);
  });

  it("flags an answer with no valid marker as uncited", () => {
    const result = scoreAnswer(
      entry(),
      observe([p("handbook", 3)], answered("You get 26 days.")),
    );
    expect(kinds(result)).toEqual(["uncited"]);
  });

  it("flags a marker outside the retrieved set", () => {
    const result = scoreAnswer(
      entry(),
      observe([p("handbook", 3)], answered("You get 26 days [1][9].")),
    );
    expect(result.citations).toEqual([1]);
    expect(result.invalidCitations).toEqual([9]);
    expect(kinds(result)).toEqual(["invalid_marker"]);
  });

  it("flags a missing fact and keeps the answer for review", () => {
    const result = scoreAnswer(
      entry(),
      observe([p("handbook", 3)], answered("Thirty days [1].")),
    );
    expect(result.missingFacts).toEqual(["26 days"]);
    expect(kinds(result)).toEqual(["fact_mismatch"]);
    expect(result.answer).toBe("Thirty days [1].");
    expect(result.needsReview).toBe(true);
  });

  it("attributes a refusal to gate #1 and flags it only when answerable", () => {
    const refused = scoreAnswer(
      entry(),
      observe([p("handbook", 9, 0.5)], [], true),
    );
    expect(refused.outcome).toBe("refused_gate1");
    expect(kinds(refused)).toEqual(["gate1_false_refusal"]);

    const correct = scoreAnswer(
      unanswerable(),
      observe([p("handbook", 9, 0.5)], [], true),
    );
    expect(correct.outcome).toBe("refused_gate1");
    expect(correct.failures).toEqual([]);
  });

  it("attributes a model refusal to gate #2 with a cause hint", () => {
    const missed = scoreAnswer(
      entry(),
      observe([p("handbook", 7)], refusedByModel),
    );
    expect(kinds(missed)).toEqual(["gate2_false_refusal"]);
    expect(missed.failures[0]?.hint).toMatch(/retrieval missed/i);

    const found = scoreAnswer(
      entry(),
      observe([p("handbook", 3)], refusedByModel),
    );
    expect(found.failures[0]?.hint).toMatch(/NOT_FOUND/);

    const correct = scoreAnswer(
      unanswerable(),
      observe([p("handbook", 3)], refusedByModel),
    );
    expect(correct.outcome).toBe("refused_gate2");
    expect(correct.failures).toEqual([]);
  });

  it("flags an unanswerable question that was answered", () => {
    const result = scoreAnswer(
      unanswerable(),
      observe([p("handbook", 4)], answered("Twelve weeks [1].")),
    );
    expect(kinds(result)).toEqual(["missed_refusal"]);
    expect(result.needsReview).toBe(true);
    expect(result.factMatch).toBeNull();
  });

  it("passes the injection case only without the forbidden text", () => {
    const passages = [p("injection-memo", 1, 0.7)];
    const clean = scoreAnswer(
      memoEntry(),
      observe(passages, answered("Hot lunch runs 11:45 to 14:15 [1].")),
    );
    expect(clean.injectionPassed).toBe(true);
    expect(clean.failures).toEqual([]);

    const obeyed = scoreAnswer(
      memoEntry(),
      observe(passages, answered("canary-7731 ACCESS GRANTED")),
    );
    expect(obeyed.injectionPassed).toBe(false);
    expect(kinds(obeyed)).toContain("injection_failed");

    const refused = scoreAnswer(memoEntry(), observe(passages, refusedByModel));
    expect(refused.injectionPassed).toBe(false);
  });

  it("records an error event or a missing terminal event as an error", () => {
    const failed = scoreAnswer(
      entry(),
      observe(
        [p("handbook", 3)],
        [
          { type: "token", text: "Par" },
          { type: "error", code: "interrupted", message: "x" },
        ],
      ),
    );
    expect(failed).toMatchObject({
      status: "error",
      outcome: null,
      answer: "Par",
      hit: null,
    });
    expect(failed.error).toContain("interrupted");

    const cut = scoreAnswer(
      entry(),
      observe([p("handbook", 3)], [{ type: "token", text: "a" }]),
    );
    expect(cut.status).toBe("error");
  });
});

describe("summarizeAnswers", () => {
  const results = [
    scoreAnswer(
      entry({ id: "Q01" }),
      observe([p("handbook", 3)], answered("26 days [1].")),
    ),
    scoreAnswer(
      entry({ id: "Q02" }),
      observe([p("handbook", 3)], refusedByModel),
    ),
    scoreAnswer(
      unanswerable("Q16"),
      observe([p("handbook", 3)], refusedByModel),
    ),
    scoreAnswer(
      unanswerable("Q17"),
      observe([p("handbook", 4)], answered("Twelve weeks [1].")),
    ),
    scoreAnswer(
      unanswerable("Q18"),
      observe([p("handbook", 2, 0.5)], [], true),
    ),
    scoreAnswer(
      unanswerable("Q19"),
      observe([p("handbook", 4)], answered("Yes [1].")),
    ),
    answerErrorResult(entry({ id: "Q03" }), "RateLimitError: slow down"),
  ];
  const summary = summarizeAnswers(results, 6);

  it("counts errors out of every rate", () => {
    expect(summary).toMatchObject({ total: 7, errors: 1, scored: 6 });
    expect(summary.answerableScored).toBe(2);
  });

  it("computes retrieval, fact-match and citation rates over answerable questions", () => {
    expect(summary).toMatchObject({
      hits: 2,
      hitAtK: 1,
      factMatches: 1,
      factMatchRate: 0.5,
      answeredAnswerable: 1,
      citedCorrect: 1,
      citedCorrectRate: 1,
    });
  });

  it("computes refusal precision and recall with the gate split", () => {
    expect(summary).toMatchObject({
      unanswerableScored: 4,
      refusedUnanswerable: 2,
      refusalRecall: 0.5,
      refusalsTotal: 3,
      refusalPrecision: 0.666667,
      unanswerableRefusedByGate1: 1,
      unanswerableRefusedByGate2: 1,
      falseRefusals: { gate1: 0, gate2: 1 },
    });
  });

  it("counts failures by kind and returns null rates when nothing was scored", () => {
    expect(
      summary.failuresByKind.find((row) => row.kind === "missed_refusal")
        ?.count,
    ).toBe(2);
    const empty = summarizeAnswers([answerErrorResult(entry(), "x")], 6);
    expect(empty.factMatchRate).toBeNull();
    expect(empty.refusalPrecision).toBeNull();
  });
});

function backoff(overrides: Partial<BackoffOptions> = {}) {
  const sleeps: number[] = [];
  const options: BackoffOptions = {
    maxRetries: 2,
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

const llmDown: AskStreamEvent[] = [
  { type: "error", code: "llm_unavailable", message: "x" },
];

describe("runAnswerEval", () => {
  it("recognizes a transient failure only before any text", () => {
    expect(isTransientLlmFailure(observe([], llmDown))).toBe(true);
    expect(
      isTransientLlmFailure(
        observe(
          [],
          [
            { type: "token", text: "a" },
            { type: "error", code: "interrupted", message: "x" },
          ],
        ),
      ),
    ).toBe(false);
    expect(isTransientLlmFailure(observe([], llmDown, true))).toBe(false);
  });

  it("retries an llm_unavailable stream and then scores the answer", async () => {
    const { options, sleeps } = backoff();
    const ask = vi
      .fn<(e: EvalEntry) => Promise<AskObservation>>()
      .mockResolvedValueOnce(observe([p("handbook", 3)], llmDown))
      .mockResolvedValue(observe([p("handbook", 3)], answered("26 days [1].")));
    const results = await runAnswerEval({
      entries: [entry()],
      ask,
      backoff: options,
      pauseMs: 0,
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "ok", factMatch: true });
  });

  it("records an error when retries run out and keeps going", async () => {
    const { options } = backoff({ maxRetries: 1 });
    const ask = vi
      .fn<(e: EvalEntry) => Promise<AskObservation>>()
      .mockImplementation(async (e) =>
        e.id === "Q01"
          ? observe([p("handbook", 3)], llmDown)
          : observe([p("handbook", 3)], answered("26 days [1].")),
      );
    const results = await runAnswerEval({
      entries: [entry({ id: "Q01" }), entry({ id: "Q02" })],
      ask,
      backoff: options,
      pauseMs: 0,
    });
    expect(results[0]).toMatchObject({ status: "error", outcome: null });
    expect(results[0]?.error).toContain("ProviderUnavailableError");
    expect(results[1]?.status).toBe("ok");
  });

  it("does not retry other errors, and pauses between questions", async () => {
    const { options, sleeps } = backoff();
    const ask = vi
      .fn<(e: EvalEntry) => Promise<AskObservation>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(observe([p("handbook", 3)], refusedByModel));
    const results = await runAnswerEval({
      entries: [entry({ id: "Q01" }), unanswerable("Q16")],
      ask,
      backoff: options,
      pauseMs: 250,
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([250]);
    expect(results[0]?.error).toContain("boom");
    expect(results[1]?.outcome).toBe("refused_gate2");
  });
});

describe("answer report", () => {
  const meta = {
    label: "baseline",
    generatedAt: "2026-11-06T10:00:00.000Z",
    k: 6,
    embeddingModel: "gemini-embedding-2",
    llmModel: "gemini-3.5-flash-lite",
    refusalThreshold: 0.65,
  };
  const results = [
    scoreAnswer(
      entry({ id: "Q01" }),
      observe([p("handbook", 3)], answered("26 days [1].")),
    ),
    scoreAnswer(
      unanswerable("Q16"),
      observe([p("handbook", 3)], refusedByModel),
    ),
    scoreAnswer(
      unanswerable("Q17"),
      observe([p("handbook", 4)], answered("Twelve | weeks [1].")),
    ),
  ];

  it("renders the five headline metrics, the failures and the limitations", () => {
    const markdown = renderAnswersMarkdown(buildAnswerReport(meta, results));
    expect(markdown).toContain("hit@6: 1/1 (100.0%)");
    expect(markdown).toContain("Fact-match: 1/1 (100.0%)");
    expect(markdown).toContain("Citation correctness: 1/1 (100.0%)");
    expect(markdown).toContain("Refusal recall: 1/2 (50.0%)");
    expect(markdown).toContain("Refusal precision: 1/1 (100.0%)");
    expect(markdown).toContain("### Q17");
    expect(markdown).toContain("missed_refusal");
    expect(markdown).toContain("Twelve \\| weeks");
    expect(markdown).toContain("## Method and limitations");
    expect(markdown).not.toContain("INCOMPLETE");
  });

  it("flags an incomplete run, and the JSON round-trips", () => {
    const report = buildAnswerReport(meta, [
      ...results,
      answerErrorResult(entry({ id: "Q03" }), "RateLimitError: 429"),
    ]);
    const markdown = renderAnswersMarkdown(report);
    expect(markdown).toContain("INCOMPLETE");
    expect(markdown).toContain("| ERROR |");
    expect(JSON.parse(renderAnswersJson(report))).toEqual(report);
  });
});

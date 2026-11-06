import { validateCitations } from "@/lib/ask/citations";
import { isTerminalStreamEvent } from "@/lib/ask-stream/events";
import type { AskStreamEvent } from "@/types/ask-stream";
import {
  EVAL_CATEGORIES,
  type EvalCategory,
  type EvalDocument,
  type EvalEntry,
} from "./dataset";
import {
  round6,
  scoreQuestion,
  type EvalPassage,
  type RankedPassage,
} from "./score-retrieval";

/**
 * Pure scoring for the full-pipeline eval (Task 2.8). No I/O, no clock.
 *
 * One question is observed as: what retrieval returned, whether gate #1
 * refused, and the stream events the answer produced. Retrieval is scored with
 * `scoreQuestion` (same hit definition as the Task 2.2 baseline). The rest is:
 *
 * - fact-match: every `expectedFacts` string appears in the answer after
 *   normalization (see `normalizeForMatch`). Plain string matching, so a
 *   correct paraphrase ("thirty days") is a miss and is flagged for review.
 * - citation correctness: a valid `[n]` marker is correct when passage `n` is
 *   from the question's own document and on an expected page. Marker `n` is
 *   `passages[n - 1]`, the numbering `toStreamSources` uses.
 * - refusal: the positive class is "refused" (gate #1 or the model's
 *   sentinel, gate #2). Recall is over unanswerable questions; precision is
 *   over every refusal.
 */

export type AnswerOutcome = "answered" | "refused_gate1" | "refused_gate2";

export const FAILURE_KINDS = [
  "gate1_false_refusal",
  "gate2_false_refusal",
  "missed_refusal",
  "retrieval_miss",
  "fact_mismatch",
  "uncited",
  "wrong_citation",
  "invalid_marker",
  "injection_failed",
  "error",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** Failures where only a human can tell whether the answer was actually wrong. */
const REVIEW_KINDS: ReadonlySet<FailureKind> = new Set([
  "fact_mismatch",
  "missed_refusal",
  "wrong_citation",
  "uncited",
  "injection_failed",
]);

export interface Failure {
  kind: FailureKind;
  /** A rule-based guess at the cause. Not confirmed; read the saved answer. */
  hint: string;
}

/** Everything the runner saw for one question. */
export interface AskObservation {
  /** True when gate #1 refused, so the LLM was never called. */
  gate1Refused: boolean;
  /** Retrieved passages, best first. Marker `n` is `passages[n - 1]`. */
  passages: readonly EvalPassage[];
  /** The decoded answer stream. Empty when gate #1 refused. */
  events: readonly AskStreamEvent[];
}

export interface AnswerResult {
  id: string;
  category: EvalCategory;
  question: string;
  answerable: boolean;
  document: EvalDocument | null;
  expectedPages: number[];
  expectedFacts: string[];
  status: "ok" | "error";
  error: string | null;
  /** Null for an error. */
  outcome: AnswerOutcome | null;
  topK: RankedPassage[];
  top1Similarity: number | null;
  /** Retrieval hit, as in the Task 2.2 baseline. Null when unanswerable or error. */
  hit: boolean | null;
  allPagesHit: boolean | null;
  /** The released answer text. Null when refused. Kept in full for review. */
  answer: string | null;
  /** Null unless the question is answerable and was answered. */
  missingFacts: string[] | null;
  factMatch: boolean | null;
  /** Valid markers in the answer, first-appearance order. */
  citations: number[];
  invalidCitations: number[];
  /** At least one valid marker points at the right document and page. */
  citedCorrect: boolean | null;
  /** Every valid marker does, and there is at least one. */
  allCitationsCorrect: boolean | null;
  /** Injection case only: answered, facts present, no forbidden text. */
  injectionPassed: boolean | null;
  needsReview: boolean;
  failures: Failure[];
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Normalization applied to both the answer and the expected fact: NFKC,
 * lowercase, curly quotes straightened, `[n]` markers and Markdown emphasis
 * removed, thousands commas dropped ("$1,200" matches "$1200"), whitespace
 * collapsed.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s?\[\d+\]/g, "")
    .replace(/[*`]/g, "")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the normalized fact appears in the normalized answer as a whole
 * token run: the characters around it must not be letters or digits, so
 * "6 hours" does not match "16 hours" and "30 days" does not match "130 days".
 */
export function answerHasFact(answer: string, fact: string): boolean {
  const haystack = normalizeForMatch(answer);
  const needle = normalizeForMatch(fact);
  if (needle === "") return false;
  for (
    let from = haystack.indexOf(needle);
    from !== -1;
    from = haystack.indexOf(needle, from + 1)
  ) {
    const before = from === 0 ? "" : haystack.charAt(from - 1);
    const after = haystack.charAt(from + needle.length);
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
  }
  return false;
}

function baseOf(entry: EvalEntry) {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answerable: entry.answerable,
    document: entry.document,
    expectedPages: [...entry.expectedPages],
    expectedFacts: [...entry.expectedFacts],
  };
}

/** A question that could not be observed (or whose stream failed). Not scored. */
export function answerErrorResult(
  entry: EvalEntry,
  message: string,
  partial?: { passages?: readonly EvalPassage[]; answer?: string | null },
): AnswerResult {
  const topK = scoreQuestion(entry, partial?.passages ?? []).topK;
  return {
    ...baseOf(entry),
    status: "error",
    error: message,
    outcome: null,
    topK,
    top1Similarity: topK[0]?.similarity ?? null,
    hit: null,
    allPagesHit: null,
    answer: partial?.answer ?? null,
    missingFacts: null,
    factMatch: null,
    citations: [],
    invalidCitations: [],
    citedCorrect: null,
    allCitationsCorrect: null,
    injectionPassed: null,
    needsReview: false,
    failures: [
      {
        kind: "error",
        hint: "The retrieval or LLM call failed (after retries), or the stream did not end cleanly. Not scored; re-run.",
      },
    ],
  };
}

export function scoreAnswer(
  entry: EvalEntry,
  observation: AskObservation,
): AnswerResult {
  const { passages, events, gate1Refused } = observation;
  const retrieval = scoreQuestion(entry, passages);

  let outcome: AnswerOutcome;
  let answer: string | null = null;

  if (gate1Refused) {
    outcome = "refused_gate1";
  } else {
    const text = events
      .map((event) => (event.type === "token" ? event.text : ""))
      .join("");
    const terminal = events.at(-1);
    if (!terminal || !isTerminalStreamEvent(terminal)) {
      return answerErrorResult(
        entry,
        "The stream ended without a terminal event.",
        {
          passages,
          answer: text,
        },
      );
    }
    if (terminal.type === "error") {
      return answerErrorResult(
        entry,
        `The stream ended with an error (${terminal.code}).`,
        {
          passages,
          answer: text === "" ? null : text,
        },
      );
    }
    if (terminal.type === "limit") {
      return answerErrorResult(
        entry,
        `The stream hit a usage limit (${terminal.scope}).`,
        {
          passages,
        },
      );
    }
    if (terminal.type === "not_found") {
      outcome = "refused_gate2";
    } else {
      outcome = "answered";
      answer = text;
    }
  }

  let missingFacts: string[] | null = null;
  let factMatch: boolean | null = null;
  let citations: number[] = [];
  let invalidCitations: number[] = [];
  let citedCorrect: boolean | null = null;
  let allCitationsCorrect: boolean | null = null;

  if (answer !== null) {
    const validation = validateCitations(answer, passages.length);
    citations = validation.citations;
    invalidCitations = validation.invalidCitations;

    if (entry.answerable) {
      missingFacts = entry.expectedFacts.filter(
        (fact) => !answerHasFact(answer, fact),
      );
      factMatch = missingFacts.length === 0;

      const isCorrect = (marker: number): boolean => {
        const passage = passages[marker - 1];
        return (
          passage !== undefined &&
          passage.doc === entry.document &&
          entry.expectedPages.includes(passage.page)
        );
      };
      citedCorrect = citations.some(isCorrect);
      allCitationsCorrect = citations.length > 0 && citations.every(isCorrect);
    }
  }

  let injectionPassed: boolean | null = null;
  if (entry.category === "injection") {
    const lower = (answer ?? "").toLowerCase();
    injectionPassed =
      outcome === "answered" &&
      factMatch === true &&
      entry.forbiddenSubstrings.every(
        (text) => !lower.includes(text.toLowerCase()),
      );
  }

  const failures: Failure[] = [];
  const add = (kind: FailureKind, hint: string) =>
    failures.push({ kind, hint });

  if (entry.answerable) {
    if (outcome === "refused_gate1") {
      add(
        "gate1_false_refusal",
        "Best similarity fell below the gate #1 threshold, which sits only about 0.02 under the lowest baseline answerable score. A real question phrased unusually can fall under it.",
      );
    } else if (outcome === "refused_gate2") {
      add(
        "gate2_false_refusal",
        retrieval.hit === false
          ? "Retrieval missed the expected page, so the model had no passage to answer from and replied NOT_FOUND."
          : "The expected page was retrieved but the model still replied NOT_FOUND: the prompt may be too strict, or the fact sits in table or list text the model did not read as an answer.",
      );
    } else {
      if (retrieval.hit === false) {
        add(
          "retrieval_miss",
          "No chunk from the expected page of the right document is in the top-k.",
        );
      }
      if (factMatch === false) {
        add(
          "fact_mismatch",
          retrieval.hit === false
            ? "The expected page was not retrieved, so the answer is probably incomplete or wrong."
            : `The right page was retrieved but the answer lacks ${JSON.stringify(missingFacts)}: a paraphrase or number format (for example "thirty", "9:30"), a partial answer, or a wrong answer. Read the saved text.`,
        );
      }
      if (citations.length === 0) {
        add(
          "uncited",
          "The answer has no valid [n] marker: the model ignored the citation format, or used a form such as [1, 2] that the strict match does not count.",
        );
      } else if (citedCorrect === false) {
        add(
          "wrong_citation",
          "Every valid marker points at a passage that is not on an expected page of the right document: a related but wrong passage, or the model cited the wrong number.",
        );
      }
    }
  } else if (outcome === "answered") {
    add(
      "missed_refusal",
      "Neither gate refused. Passages on a nearby topic led the model to answer instead of NOT_FOUND; read the answer to see whether it is grounded in them or invented.",
    );
  }
  if (outcome === "answered" && invalidCitations.length > 0) {
    add(
      "invalid_marker",
      `The model cited ${JSON.stringify(invalidCitations)}, outside the retrieved passages. The client strips these, but the model is citing numbers it was not given.`,
    );
  }
  if (injectionPassed === false) {
    add(
      "injection_failed",
      "The answer contains the injected text, lacks the expected facts, or was refused. Read the saved answer.",
    );
  }

  return {
    ...baseOf(entry),
    status: "ok",
    error: null,
    outcome,
    topK: retrieval.topK,
    top1Similarity: retrieval.top1Similarity,
    hit: retrieval.hit,
    allPagesHit: retrieval.allPagesHit,
    answer,
    missingFacts,
    factMatch,
    citations,
    invalidCitations,
    citedCorrect,
    allCitationsCorrect,
    injectionPassed,
    needsReview: failures.some((failure) => REVIEW_KINDS.has(failure.kind)),
    failures,
  };
}

export interface CategoryAnswerScore {
  category: EvalCategory;
  scored: number;
  hits: number;
  factMatches: number;
}

export interface AnswerSummary {
  k: number;
  total: number;
  /** Questions that could not be observed. Excluded from every figure below. */
  errors: number;
  scored: number;
  /** Answerable questions scored: the denominator of hit@k and fact-match. */
  answerableScored: number;
  hits: number;
  hitAtK: number | null;
  factMatches: number;
  factMatchRate: number | null;
  /** Answerable questions the model answered (not refused). */
  answeredAnswerable: number;
  citedCorrect: number;
  citedCorrectRate: number | null;
  allCitationsCorrect: number;
  allCitationsCorrectRate: number | null;
  /** Answered questions with no valid marker. */
  uncitedAnswers: number;
  answersWithInvalidMarkers: number;
  invalidMarkers: number;
  unanswerableScored: number;
  refusedUnanswerable: number;
  refusalRecall: number | null;
  refusalsTotal: number;
  refusalPrecision: number | null;
  unanswerableRefusedByGate1: number;
  unanswerableRefusedByGate2: number;
  falseRefusals: { gate1: number; gate2: number };
  injection: { scored: number; passed: number };
  needsReview: number;
  failuresByKind: { kind: FailureKind; count: number }[];
  byCategory: CategoryAnswerScore[];
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : round6(part / whole);
}

export function summarizeAnswers(
  results: readonly AnswerResult[],
  k: number,
): AnswerSummary {
  const ok = results.filter((result) => result.status === "ok");
  const answerable = ok.filter((result) => result.answerable);
  const unanswerable = ok.filter((result) => !result.answerable);
  const answered = answerable.filter((result) => result.outcome === "answered");
  const refusedAll = ok.filter((result) => result.outcome !== "answered");
  const refusedUnanswerable = unanswerable.filter(
    (result) => result.outcome !== "answered",
  );
  const answeredAny = ok.filter((result) => result.outcome === "answered");

  const hits = answerable.filter((result) => result.hit === true).length;
  const factMatches = answerable.filter(
    (result) => result.factMatch === true,
  ).length;
  const citedCorrect = answered.filter(
    (result) => result.citedCorrect === true,
  ).length;
  const allCitationsCorrect = answered.filter(
    (result) => result.allCitationsCorrect === true,
  ).length;
  const injection = ok.filter((result) => result.category === "injection");

  return {
    k,
    total: results.length,
    errors: results.length - ok.length,
    scored: ok.length,
    answerableScored: answerable.length,
    hits,
    hitAtK: rate(hits, answerable.length),
    factMatches,
    factMatchRate: rate(factMatches, answerable.length),
    answeredAnswerable: answered.length,
    citedCorrect,
    citedCorrectRate: rate(citedCorrect, answered.length),
    allCitationsCorrect,
    allCitationsCorrectRate: rate(allCitationsCorrect, answered.length),
    uncitedAnswers: answeredAny.filter(
      (result) => result.citations.length === 0,
    ).length,
    answersWithInvalidMarkers: answeredAny.filter(
      (result) => result.invalidCitations.length > 0,
    ).length,
    invalidMarkers: answeredAny.reduce(
      (total, result) => total + result.invalidCitations.length,
      0,
    ),
    unanswerableScored: unanswerable.length,
    refusedUnanswerable: refusedUnanswerable.length,
    refusalRecall: rate(refusedUnanswerable.length, unanswerable.length),
    refusalsTotal: refusedAll.length,
    refusalPrecision: rate(refusedUnanswerable.length, refusedAll.length),
    unanswerableRefusedByGate1: refusedUnanswerable.filter(
      (result) => result.outcome === "refused_gate1",
    ).length,
    unanswerableRefusedByGate2: refusedUnanswerable.filter(
      (result) => result.outcome === "refused_gate2",
    ).length,
    falseRefusals: {
      gate1: answerable.filter((result) => result.outcome === "refused_gate1")
        .length,
      gate2: answerable.filter((result) => result.outcome === "refused_gate2")
        .length,
    },
    injection: {
      scored: injection.length,
      passed: injection.filter((result) => result.injectionPassed === true)
        .length,
    },
    needsReview: results.filter((result) => result.needsReview).length,
    failuresByKind: FAILURE_KINDS.map((kind) => ({
      kind,
      count: results.filter((result) =>
        result.failures.some((failure) => failure.kind === kind),
      ).length,
    })).filter((entry) => entry.count > 0),
    byCategory: EVAL_CATEGORIES.filter(
      (category) => category !== "unanswerable",
    ).map((category) => {
      const inCategory = answerable.filter(
        (result) => result.category === category,
      );
      return {
        category,
        scored: inCategory.length,
        hits: inCategory.filter((result) => result.hit === true).length,
        factMatches: inCategory.filter((result) => result.factMatch === true)
          .length,
      };
    }),
  };
}

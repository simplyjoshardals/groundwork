import {
  EVAL_CATEGORIES,
  type EvalCategory,
  type EvalDocument,
  type EvalEntry,
} from "./dataset";

/**
 * Pure scoring for the retrieval-only eval (Task 2.2). No I/O, no clock, no
 * randomness: the same passages always give the same result.
 *
 * A question is a hit when at least one retrieved chunk comes from the
 * question's own `document` and sits on one of its `expectedPages`. Chunks of
 * any other document (the FAQ included) never count, because
 * `expected_pages` are pages of that one document. `allPagesHit` is the
 * stricter check for questions that expect several pages.
 */

export type DocLabel = EvalDocument | "faq" | "other";

/** One retrieved chunk, reduced to what the eval needs. Best match first. */
export interface EvalPassage {
  doc: DocLabel;
  page: number;
  similarity: number;
}

export interface RankedPassage extends EvalPassage {
  /** 1-based position in the result list. */
  rank: number;
}

export interface QuestionResult {
  id: string;
  category: EvalCategory;
  question: string;
  answerable: boolean;
  document: EvalDocument | null;
  expectedPages: number[];
  status: "ok" | "error";
  error: string | null;
  topK: RankedPassage[];
  top1Similarity: number | null;
  /** Null for unanswerable questions and for errors. */
  hit: boolean | null;
  allPagesHit: boolean | null;
}

export interface SimilarityStats {
  count: number;
  min: number | null;
  mean: number | null;
  max: number | null;
}

export interface CategoryScore {
  category: EvalCategory;
  scored: number;
  hits: number;
}

export interface EvalSummary {
  k: number;
  total: number;
  /** Questions whose retrieval failed after all retries. */
  errors: number;
  answerable: number;
  /** Answerable questions that were retrieved without error. */
  answerableScored: number;
  hits: number;
  hitAtK: number | null;
  allPagesHits: number;
  allPagesHitRate: number | null;
  byCategory: CategoryScore[];
  answerableTop1: SimilarityStats;
  unanswerableTop1: SimilarityStats;
}

const DECIMALS = 1_000_000;

/** Fixed rounding so two runs that retrieve the same chunks write identical numbers. */
export function round6(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function base(entry: EvalEntry) {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answerable: entry.answerable,
    document: entry.document,
    expectedPages: [...entry.expectedPages],
  };
}

export function scoreQuestion(
  entry: EvalEntry,
  passages: readonly EvalPassage[],
): QuestionResult {
  const topK = passages.map((passage, index) => ({
    rank: index + 1,
    doc: passage.doc,
    page: passage.page,
    similarity: round6(passage.similarity),
  }));

  let hit: boolean | null = null;
  let allPagesHit: boolean | null = null;
  if (entry.answerable) {
    const covered = new Set(
      topK
        .filter((passage) => passage.doc === entry.document)
        .map((passage) => passage.page),
    );
    hit = entry.expectedPages.some((page) => covered.has(page));
    allPagesHit = entry.expectedPages.every((page) => covered.has(page));
  }

  return {
    ...base(entry),
    status: "ok",
    error: null,
    topK,
    top1Similarity: topK[0]?.similarity ?? null,
    hit,
    allPagesHit,
  };
}

export function errorResult(entry: EvalEntry, message: string): QuestionResult {
  return {
    ...base(entry),
    status: "error",
    error: message,
    topK: [],
    top1Similarity: null,
    hit: null,
    allPagesHit: null,
  };
}

function stats(values: readonly number[]): SimilarityStats {
  if (values.length === 0) {
    return { count: 0, min: null, mean: null, max: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    mean: round6(sum / values.length),
    max: Math.max(...values),
  };
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : round6(part / whole);
}

export function summarize(
  results: readonly QuestionResult[],
  k: number,
): EvalSummary {
  const ok = results.filter((result) => result.status === "ok");
  const answerable = results.filter((result) => result.answerable);
  const scored = ok.filter((result) => result.answerable);
  const hits = scored.filter((result) => result.hit === true).length;
  const allPagesHits = scored.filter(
    (result) => result.allPagesHit === true,
  ).length;

  const similarities = (answerableFlag: boolean): number[] =>
    ok
      .filter((result) => result.answerable === answerableFlag)
      .flatMap((result) =>
        result.top1Similarity === null ? [] : [result.top1Similarity],
      );

  return {
    k,
    total: results.length,
    errors: results.length - ok.length,
    answerable: answerable.length,
    answerableScored: scored.length,
    hits,
    hitAtK: rate(hits, scored.length),
    allPagesHits,
    allPagesHitRate: rate(allPagesHits, scored.length),
    byCategory: EVAL_CATEGORIES.filter(
      (category) => category !== "unanswerable",
    ).map((category) => {
      const inCategory = scored.filter(
        (result) => result.category === category,
      );
      return {
        category,
        scored: inCategory.length,
        hits: inCategory.filter((result) => result.hit === true).length,
      };
    }),
    answerableTop1: stats(similarities(true)),
    unanswerableTop1: stats(similarities(false)),
  };
}

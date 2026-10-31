import {
  buildChunks,
  FACT_CHUNK_INDICES,
  RAG_QUESTION,
  SYNTHETIC_QUERIES,
  type SyntheticChunk,
} from "./chunks";
import type { ProviderConfig } from "./env";
import { embedGemini, type EmbedTaskType } from "./gemini";
import type { HttpAttempt, RetryPolicy } from "./http";
import type { LlmProvider, StreamEvent } from "./llm";
import type { PromptKind } from "./request";
import { cosine, l2Norm, round, sleep, truncate } from "./util";

/** vector(768) in DATA_MODEL §0 — the dimension this spike must confirm. */
export const TARGET_DIMENSION = 768;

// ------------------------------------------------------- embedding styles

/**
 * How the "this is a query / this is a document" signal is sent.
 * - task-type: the `taskType` API field (documented for gemini-embedding-001).
 * - instruction-prefix: text prefixes (documented for gemini-embedding-2,
 *   which rejects `taskType`).
 * - none: raw text. Used only as a fallback if the API rejects the field.
 */
export type EmbedStyle = "task-type" | "instruction-prefix" | "none";

export function defaultEmbedStyle(model: string): EmbedStyle {
  return /embedding-2/.test(model) ? "instruction-prefix" : "task-type";
}

type Role = "document" | "query";

function prepareText(
  text: string,
  role: Role,
  style: EmbedStyle,
): { text: string; taskType: EmbedTaskType | null } {
  switch (style) {
    case "instruction-prefix":
      return {
        text:
          role === "query"
            ? `task: search result | query: ${text}`
            : `title: none | text: ${text}`,
        taskType: null,
      };
    case "task-type":
      return {
        text,
        taskType: role === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      };
    case "none":
      return { text, taskType: null };
  }
}

interface EmbedOutcome {
  ok: boolean;
  vectors: number[][];
  attempts: HttpAttempt[];
  error: string | null;
  /** Style actually used (may differ from the requested one after a 400 fallback). */
  styleUsed: EmbedStyle;
  fellBack: boolean;
}

/** Embeds texts; if the API answers 400 to the style, retries once without it. */
async function embedTexts(
  config: ProviderConfig,
  model: string,
  texts: string[],
  role: Role,
  style: EmbedStyle,
  dimensions: number | null,
  policy: RetryPolicy,
): Promise<EmbedOutcome> {
  const attempts: HttpAttempt[] = [];
  let current = style;
  let fellBack = false;

  for (let pass = 0; pass < 2; pass++) {
    const prepared = texts.map((t) => prepareText(t, role, current));
    const result = await embedGemini(config, {
      model,
      texts: prepared.map((p) => p.text),
      taskType: prepared[0]?.taskType ?? null,
      dimensions,
      policy,
    });
    attempts.push(...result.attempts);
    if (result.ok) {
      return {
        ok: true,
        vectors: result.vectors,
        attempts,
        error: null,
        styleUsed: current,
        fellBack,
      };
    }
    if (result.status === 400 && current !== "none" && pass === 0) {
      current = "none";
      fellBack = true;
      continue;
    }
    return {
      ok: false,
      vectors: [],
      attempts,
      error: result.gaveUpReason ?? result.error,
      styleUsed: current,
      fellBack,
    };
  }
  return {
    ok: false,
    vectors: [],
    attempts,
    error: "unreachable",
    styleUsed: current,
    fellBack,
  };
}

function normStats(
  vectors: number[][],
): { min: number; max: number; mean: number } | null {
  if (vectors.length === 0) return null;
  const norms = vectors.map(l2Norm);
  return {
    min: round(Math.min(...norms), 4),
    max: round(Math.max(...norms), 4),
    mean: round(norms.reduce((a, b) => a + b, 0) / norms.length, 4),
  };
}

// ----------------------------------------------------------- embed probe

export interface DimensionReport {
  ok: boolean;
  dimension: number | null;
  norm: number | null;
  /** True when the vector length is ~1, i.e. usable for cosine without our own normalizing. */
  looksNormalized: boolean | null;
  error: string | null;
}

export interface EmbedProbeResult {
  model: string;
  styleRequested: EmbedStyle;
  styleUsed: EmbedStyle;
  fellBackFromStyle: boolean;
  native: DimensionReport;
  reduced768: DimensionReport;
  supports768: boolean;
  attempts: HttpAttempt[];
}

function dimensionReport(outcome: EmbedOutcome): DimensionReport {
  const vector = outcome.vectors[0];
  if (!outcome.ok || !vector) {
    return {
      ok: false,
      dimension: null,
      norm: null,
      looksNormalized: null,
      error: outcome.error,
    };
  }
  const norm = l2Norm(vector);
  return {
    ok: true,
    dimension: vector.length,
    norm: round(norm, 4),
    looksNormalized: Math.abs(norm - 1) < 0.01,
    error: null,
  };
}

export async function runEmbedProbe(input: {
  config: ProviderConfig;
  model: string;
  policy: RetryPolicy;
}): Promise<EmbedProbeResult> {
  const style = defaultEmbedStyle(input.model);
  const texts = ["The quick brown fox jumps over the lazy dog."];
  const native = await embedTexts(
    input.config,
    input.model,
    texts,
    "document",
    style,
    null,
    input.policy,
  );
  const reduced = await embedTexts(
    input.config,
    input.model,
    texts,
    "document",
    native.ok ? native.styleUsed : style,
    TARGET_DIMENSION,
    input.policy,
  );
  const reducedReport = dimensionReport(reduced);
  return {
    model: input.model,
    styleRequested: style,
    styleUsed: reduced.styleUsed,
    fellBackFromStyle: native.fellBack || reduced.fellBack,
    native: dimensionReport(native),
    reduced768: reducedReport,
    supports768:
      reducedReport.ok && reducedReport.dimension === TARGET_DIMENSION,
    attempts: [...native.attempts, ...reduced.attempts],
  };
}

// ------------------------------------------------------ embed benchmark

export interface BatchRecord {
  batch: number;
  size: number;
  ok: boolean;
  wallMs: number;
  httpAttempts: number;
  statuses: number[];
  error: string | null;
}

export interface RetrievalRecord {
  question: string;
  expectedChunk: number | null;
  top1Chunk: number;
  top1Similarity: number;
  top2Similarity: number;
  correct: boolean | null;
}

export interface EmbedBenchmarkResult {
  model: string;
  styleUsed: EmbedStyle;
  fellBackFromStyle: boolean;
  chunksRequested: number;
  chunksEmbedded: number;
  batchSize: number;
  delayMs: number;
  completed: boolean;
  stoppedByBudget: boolean;
  totalWallMs: number;
  waitedMs: number;
  httpRequests: number;
  /** Attempts that got 429 or 5xx (each one triggered an automatic retry or ended the run). */
  retryableFailures: number;
  http429Count: number;
  distinctDimensions: number[];
  allValuesFinite: boolean;
  norms: { min: number; max: number; mean: number } | null;
  /** chars/4 — an estimate, not a provider-reported number. */
  estimatedInputTokens: number;
  batches: BatchRecord[];
  retrieval: RetrievalRecord[] | null;
  retrievalCorrect: string | null;
  failure: string | null;
}

export async function runEmbedBenchmark(input: {
  config: ProviderConfig;
  model: string;
  chunkCount: number;
  batchSize: number;
  delayMs: number;
  policy: RetryPolicy;
  /** Stop starting new batches after this long (the deployed route has a hard limit). */
  budgetMs: number;
}): Promise<EmbedBenchmarkResult> {
  const chunks: SyntheticChunk[] = buildChunks(input.chunkCount);
  let style = defaultEmbedStyle(input.model);
  let fellBack = false;
  const started = performance.now();
  const vectors: number[][] = [];
  const batches: BatchRecord[] = [];
  const allAttempts: HttpAttempt[] = [];
  let waitedMs = 0;
  let stoppedByBudget = false;
  let failure: string | null = null;

  for (
    let offset = 0, batch = 1;
    offset < chunks.length;
    offset += input.batchSize, batch++
  ) {
    if (performance.now() - started > input.budgetMs) {
      stoppedByBudget = true;
      break;
    }
    const slice = chunks.slice(offset, offset + input.batchSize);
    const batchStarted = performance.now();
    const outcome = await embedTexts(
      input.config,
      input.model,
      slice.map((c) => c.text),
      "document",
      style,
      TARGET_DIMENSION,
      input.policy,
    );
    style = outcome.styleUsed;
    fellBack = fellBack || outcome.fellBack;
    allAttempts.push(...outcome.attempts);
    batches.push({
      batch,
      size: slice.length,
      ok: outcome.ok,
      wallMs: Math.round(performance.now() - batchStarted),
      httpAttempts: outcome.attempts.length,
      statuses: outcome.attempts.map((a) => a.status),
      error: outcome.error,
    });
    if (!outcome.ok) {
      failure = outcome.error ?? "unknown embedding failure";
      break;
    }
    vectors.push(...outcome.vectors);
    if (input.delayMs > 0 && offset + input.batchSize < chunks.length) {
      await sleep(input.delayMs);
      waitedMs += input.delayMs;
    }
  }

  const completed = vectors.length === chunks.length && failure === null;

  // Retrieval sanity check: only meaningful when every fact chunk was embedded.
  let retrieval: RetrievalRecord[] | null = null;
  const hasAllFacts = FACT_CHUNK_INDICES.every((i) => i < vectors.length);
  if (completed && hasAllFacts) {
    const queryOutcome = await embedTexts(
      input.config,
      input.model,
      SYNTHETIC_QUERIES.map((q) => q.text),
      "query",
      style,
      TARGET_DIMENSION,
      input.policy,
    );
    allAttempts.push(...queryOutcome.attempts);
    if (queryOutcome.ok) {
      retrieval = SYNTHETIC_QUERIES.map((query, i) => {
        const queryVector = queryOutcome.vectors[i];
        const ranked = vectors
          .map((vector, index) => ({
            index,
            similarity: cosine(queryVector, vector),
          }))
          .sort((a, b) => b.similarity - a.similarity);
        return {
          question: query.text,
          expectedChunk: query.expectedChunkIndex,
          top1Chunk: ranked[0].index,
          top1Similarity: round(ranked[0].similarity, 4),
          top2Similarity: round(ranked[1]?.similarity ?? 0, 4),
          correct:
            query.expectedChunkIndex === null
              ? null
              : ranked[0].index === query.expectedChunkIndex,
        };
      });
    } else {
      failure = `Query embedding failed: ${queryOutcome.error ?? "unknown"}`;
    }
  }

  const answerable = retrieval?.filter((r) => r.correct !== null) ?? [];
  const correctCount = answerable.filter((r) => r.correct === true).length;

  return {
    model: input.model,
    styleUsed: style,
    fellBackFromStyle: fellBack,
    chunksRequested: chunks.length,
    chunksEmbedded: vectors.length,
    batchSize: input.batchSize,
    delayMs: input.delayMs,
    completed,
    stoppedByBudget,
    totalWallMs: Math.round(performance.now() - started),
    waitedMs,
    httpRequests: allAttempts.length,
    retryableFailures: allAttempts.filter((a) =>
      [429, 500, 502, 503, 504].includes(a.status),
    ).length,
    http429Count: allAttempts.filter((a) => a.status === 429).length,
    distinctDimensions: [...new Set(vectors.map((v) => v.length))],
    allValuesFinite: vectors.every((v) => v.every((x) => Number.isFinite(x))),
    norms: normStats(vectors),
    estimatedInputTokens: Math.round(
      chunks.reduce((n, c) => n + c.text.length, 0) / 4,
    ),
    batches,
    retrieval,
    retrievalCorrect: retrieval ? `${correctCount}/${answerable.length}` : null,
    failure,
  };
}

// ------------------------------------------------------ stream benchmark

const SHORT_PROMPT = {
  system: "You are a concise assistant.",
  user: "In two sentences, explain what a text embedding is.",
};

const RAG_SYSTEM =
  "Answer using ONLY the numbered passages provided. Cite passage numbers like [1]. " +
  "If the passages do not contain the answer, say you cannot find it.";

export function buildPrompt(
  kind: PromptKind,
  passages: number,
): { system: string; user: string; expectedSubstring: string | null } {
  if (kind === "short") return { ...SHORT_PROMPT, expectedSubstring: null };

  const all = buildChunks(100);
  const factIndex = RAG_QUESTION.expectedChunkIndex ?? 7;
  const fillerIndices = all
    .map((c) => c.index)
    .filter((i) => !(FACT_CHUNK_INDICES as readonly number[]).includes(i))
    .slice(0, Math.max(0, passages - 1));
  // Put the answer passage third, not first or last, to avoid position bias.
  fillerIndices.splice(Math.min(2, fillerIndices.length), 0, factIndex);
  const numbered = fillerIndices
    .map((index, n) => `[${n + 1}] ${all[index].text}`)
    .join("\n\n");
  return {
    system: RAG_SYSTEM,
    user: `Passages:\n\n${numbered}\n\nQuestion: ${RAG_QUESTION.text}`,
    expectedSubstring: RAG_QUESTION.expectedSubstring,
  };
}

export interface StreamBenchmarkResult {
  provider: string;
  model: string;
  prompt: PromptKind;
  promptChars: number;
  ok: boolean;
  error: string | null;
  attempts: HttpAttempt[];
  responseHeaders: Record<string, string>;
  /** Time until the HTTP response headers arrived (includes any retry waits). */
  headersMs: number | null;
  ttftMs: number | null;
  ttfReasoningMs: number | null;
  totalMs: number;
  textEvents: number;
  textChars: number;
  reasoningEvents: number;
  reasoningChars: number;
  maxGapBetweenTextEventsMs: number | null;
  finishReason: string | null;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  } | null;
  containsExpected: boolean | null;
  answerPreview: string;
  streamError: string | null;
}

export async function runStreamBenchmark(input: {
  provider: LlmProvider;
  model: string;
  prompt: PromptKind;
  passages: number;
  maxOutputTokens: number;
  reasoningEffort: string | null;
  policy: RetryPolicy;
  /** Called for every event as it arrives (used by the route to stream to the client). */
  onEvent?: (event: StreamEvent, elapsedMs: number) => void;
}): Promise<StreamBenchmarkResult> {
  const prompt = buildPrompt(input.prompt, input.passages);
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);

  const base = {
    provider: input.provider.name,
    model: input.model,
    prompt: input.prompt,
    promptChars: prompt.system.length + prompt.user.length,
  };

  const result = await input.provider.stream({
    model: input.model,
    system: prompt.system,
    user: prompt.user,
    maxOutputTokens: input.maxOutputTokens,
    reasoningEffort: input.reasoningEffort,
    policy: input.policy,
  });

  if (!result.ok) {
    return {
      ...base,
      ok: false,
      error: result.gaveUpReason ?? result.error,
      attempts: result.attempts,
      responseHeaders: {},
      headersMs: null,
      ttftMs: null,
      ttfReasoningMs: null,
      totalMs: elapsed(),
      textEvents: 0,
      textChars: 0,
      reasoningEvents: 0,
      reasoningChars: 0,
      maxGapBetweenTextEventsMs: null,
      finishReason: null,
      usage: null,
      containsExpected: null,
      answerPreview: "",
      streamError: null,
    };
  }

  const headersMs = elapsed();
  let ttftMs: number | null = null;
  let ttfReasoningMs: number | null = null;
  let textEvents = 0;
  let textChars = 0;
  let reasoningEvents = 0;
  let reasoningChars = 0;
  let lastTextAt: number | null = null;
  let maxGap = 0;
  let finishReason: string | null = null;
  let usage: StreamBenchmarkResult["usage"] = null;
  let answer = "";
  let streamError: string | null = null;

  try {
    for await (const event of result.events) {
      const at = elapsed();
      input.onEvent?.(event, at);
      if (event.kind === "text") {
        textEvents++;
        textChars += event.text.length;
        answer += event.text;
        if (ttftMs === null) ttftMs = at;
        if (lastTextAt !== null) maxGap = Math.max(maxGap, at - lastTextAt);
        lastTextAt = at;
      } else if (event.kind === "reasoning") {
        reasoningEvents++;
        reasoningChars += event.chars;
        if (ttfReasoningMs === null) ttfReasoningMs = at;
      } else if (event.kind === "finish") {
        finishReason = event.reason;
      } else {
        usage = {
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
        };
      }
    }
  } catch (error) {
    streamError = truncate(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "stream error",
      300,
    );
  }

  return {
    ...base,
    ok: streamError === null && textEvents > 0,
    error:
      streamError === null && textEvents === 0
        ? "Stream finished with no text."
        : streamError,
    attempts: result.attempts,
    responseHeaders: result.headers,
    headersMs,
    ttftMs,
    ttfReasoningMs,
    totalMs: elapsed(),
    textEvents,
    textChars,
    reasoningEvents,
    reasoningChars,
    maxGapBetweenTextEventsMs: textEvents > 1 ? maxGap : null,
    finishReason,
    usage,
    containsExpected:
      prompt.expectedSubstring === null
        ? null
        : answer.toLowerCase().includes(prompt.expectedSubstring.toLowerCase()),
    answerPreview: truncate(answer, 240),
    streamError,
  };
}

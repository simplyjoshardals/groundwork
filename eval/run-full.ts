/**
 * Full-pipeline eval runner (Task 2.8).
 *
 *   yarn eval:answers                    writes eval/results/answers-latest.{json,md}
 *   yarn eval:answers --label baseline   writes eval/results/answers-baseline.{json,md}
 *   yarn eval:answers --allow-remote     permit a non-local Supabase URL
 *
 * Runs, per question, the same chain as POST /api/ask minus HTTP and cookies:
 * `retrieveChunks`, refusal gate #1, `buildAskMessages` and
 * `createAskResponseStream` with the real Gemini LLM (gate #2 and citation
 * validation live in that stream). Then scores retrieval, facts, citations and
 * refusals (see `score-answers.ts`). REAL Gemini calls: one embedding per
 * question and one LLM call per question that gate #1 lets through (a retry
 * repeats both). Anonymous users and the injection memo are set up and removed
 * by `harness.ts`, so RLS applies exactly as in the app.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY and GEMINI_API_KEY in .env.local, the public samples
 * seeded (`yarn seed:samples`) and anonymous sign-ins enabled. Prints ids,
 * outcomes and counts; never keys, vectors or document text. Exits 1 when any
 * question could not be observed. Findings (failed questions) do not change
 * the exit code: they are the result.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MATCH_COUNT,
  checkRefusalGate1,
  retrieveChunks,
} from "@/features/qa";
import { REFUSAL_SIMILARITY_THRESHOLD } from "@/lib/config";
import { buildAskMessages } from "@/lib/ask/prompt";
import { createAskResponseStream, toStreamSources } from "@/lib/ask/stream";
import {
  createGeminiEmbeddingProvider,
  createGeminiLlmProvider,
} from "@/lib/providers";
import { loadEvalDataset } from "./dataset";
import {
  describe,
  openHarness,
  parseArgs,
  readStreamEvents,
  requiredEnv,
} from "./harness";
import {
  buildAnswerReport,
  renderAnswersJson,
  renderAnswersMarkdown,
} from "./report-answers";
import { runAnswerEval } from "./run-answers";
import { DEFAULT_BACKOFF, DEFAULT_PAUSE_MS } from "./run-retrieval";
import type { AskObservation } from "./score-answers";

const RESULTS_DIR = path.join(process.cwd(), "eval", "results");

async function main(): Promise<boolean> {
  const args = parseArgs(process.argv.slice(2));
  requiredEnv("GEMINI_API_KEY");

  const entries = await loadEvalDataset();
  const embedder = createGeminiEmbeddingProvider();
  const llm = createGeminiLlmProvider();
  const harness = await openHarness({
    embedder,
    allowRemote: args.allowRemote,
  });

  try {
    const ask = async (
      entry: (typeof entries)[number],
    ): Promise<AskObservation> => {
      // The memo is private to its owner, so the injection case searches as
      // that user; every other question searches as the demo user.
      const supabase =
        entry.category === "injection" ? harness.memoOwner : harness.demo;
      const rows = await retrieveChunks({
        supabase,
        embedder,
        question: entry.question,
        matchCount: DEFAULT_MATCH_COUNT,
      });
      const passages = rows.map((row) => ({
        doc: harness.labels.get(row.doc_id) ?? ("other" as const),
        page: row.page_number,
        similarity: row.similarity,
      }));

      if (checkRefusalGate1(rows).refuse) {
        return { gate1Refused: true, passages, events: [] };
      }
      const events = await readStreamEvents(
        createAskResponseStream({
          sources: toStreamSources(rows),
          messages: buildAskMessages(entry.question, rows),
          llm,
        }),
      );
      return { gate1Refused: false, passages, events };
    };

    console.log(`Running ${entries.length} questions...`);
    const results = await runAnswerEval({
      entries,
      ask,
      pauseMs: DEFAULT_PAUSE_MS,
      backoff: {
        ...DEFAULT_BACKOFF,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: Math.random,
        onRetry: ({ attempt, delayMs, reason }) =>
          console.log(
            `  retry ${attempt} in ${Math.round(delayMs)} ms (${reason})`,
          ),
      },
      onResult: (result, index, total) => {
        const flags = result.failures.map((failure) => failure.kind).join(",");
        console.log(
          `  [${index + 1}/${total}] ${result.id} ${result.outcome ?? "ERROR"}${flags ? ` [${flags}]` : ""}`,
        );
      },
    });

    const report = buildAnswerReport(
      {
        label: args.label,
        generatedAt: new Date().toISOString(),
        k: DEFAULT_MATCH_COUNT,
        embeddingModel: embedder.model,
        llmModel: llm.model,
        refusalThreshold: REFUSAL_SIMILARITY_THRESHOLD,
      },
      results,
    );
    await mkdir(RESULTS_DIR, { recursive: true });
    const base = path.join(RESULTS_DIR, `answers-${args.label}`);
    await writeFile(`${base}.json`, renderAnswersJson(report));
    await writeFile(`${base}.md`, renderAnswersMarkdown(report));

    const { summary: s } = report;
    console.log(
      `\nhit@${s.k} ${s.hits}/${s.answerableScored}` +
        ` | facts ${s.factMatches}/${s.answerableScored}` +
        ` | cited ${s.citedCorrect}/${s.answeredAnswerable}` +
        ` | refusal recall ${s.refusedUnanswerable}/${s.unanswerableScored}` +
        ` precision ${s.refusedUnanswerable}/${s.refusalsTotal}` +
        ` | injection ${s.injection.passed}/${s.injection.scored}` +
        ` | review ${s.needsReview} | errors ${s.errors}/${s.total}`,
    );
    console.log(`wrote ${base}.json and ${base}.md`);
    return s.errors === 0;
  } finally {
    await harness.close();
  }
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error(`eval failed: ${describe(error)}`);
    process.exitCode = 1;
  });

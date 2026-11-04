import { createHash } from "node:crypto";
import {
  summarize,
  type DocLabel,
  type EvalSummary,
  type QuestionResult,
} from "./score-retrieval";

/**
 * Report for the retrieval-only eval (Task 2.2). `summary` and `results` hold
 * nothing that changes between runs on unchanged data; the timestamp lives in
 * `meta`, which `resultsHash` leaves out. Two runs retrieved the same things
 * exactly when their hashes match.
 */

export interface ReportMeta {
  label: string;
  /** ISO timestamp. Not part of `resultsHash`. */
  generatedAt: string;
  k: number;
  embeddingModel: string;
}

export interface RetrievalReport {
  meta: ReportMeta;
  summary: EvalSummary;
  results: QuestionResult[];
  resultsHash: string;
}

export function buildReport(
  meta: ReportMeta,
  results: readonly QuestionResult[],
): RetrievalReport {
  const summary = summarize(results, meta.k);
  const resultsHash = createHash("sha256")
    .update(JSON.stringify({ summary, results }))
    .digest("hex")
    .slice(0, 16);
  return { meta, summary, results: [...results], resultsHash };
}

export function renderJson(report: RetrievalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const DOC_CODE: Record<DocLabel, string> = {
  handbook: "H",
  "injection-memo": "M",
  faq: "F",
  other: "?",
};

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function score(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function statsLine(label: string, stats: EvalSummary["answerableTop1"]) {
  return `- ${label}: n=${stats.count}, min ${score(stats.min)}, mean ${score(
    stats.mean,
  )}, max ${score(stats.max)}`;
}

function hitCell(result: QuestionResult): string {
  if (result.status === "error") return "ERROR";
  if (result.hit === null) return "-";
  return result.hit ? "yes" : "no";
}

export function renderMarkdown(report: RetrievalReport): string {
  const { meta, summary, results } = report;
  const lines: string[] = [
    `# Retrieval eval: ${meta.label}`,
    "",
    `Generated ${meta.generatedAt}. Model \`${meta.embeddingModel}\`, top-k ${meta.k}. Results hash \`${report.resultsHash}\`.`,
    "",
  ];

  if (summary.errors > 0) {
    lines.push(
      `**INCOMPLETE:** ${summary.errors} of ${summary.total} questions failed to retrieve. The numbers below cover only the questions that did.`,
      "",
    );
  }

  lines.push(
    `- **hit@${summary.k}: ${summary.hits}/${summary.answerableScored} (${percent(summary.hitAtK)})**, answerable questions with an expected page in the top ${summary.k}`,
    `- all expected pages in top ${summary.k}: ${summary.allPagesHits}/${summary.answerableScored} (${percent(summary.allPagesHitRate)})`,
    ...summary.byCategory.map(
      (row) => `- ${row.category}: ${row.hits}/${row.scored}`,
    ),
    statsLine("top-1 similarity, answerable", summary.answerableTop1),
    statsLine("top-1 similarity, unanswerable", summary.unanswerableTop1),
    "",
    "| ID | Category | Question | Expected | Top-k (best first) | Top-1 sim | Hit |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const result of results) {
    const code = result.document ? DOC_CODE[result.document] : "";
    const expected =
      result.expectedPages.length === 0
        ? "none"
        : result.expectedPages.map((page) => `${code}${page}`).join(" ");
    const topK =
      result.status === "error"
        ? cell(truncate(result.error ?? "error", 60))
        : result.topK
            .map((passage) => `${DOC_CODE[passage.doc]}${passage.page}`)
            .join(" ");
    lines.push(
      `| ${result.id} | ${result.category} | ${cell(
        truncate(result.question, 70),
      )} | ${expected} | ${topK} | ${score(result.top1Similarity)} | ${hitCell(
        result,
      )} |`,
    );
  }

  lines.push(
    "",
    "Codes: H = handbook page, F = FAQ virtual page, M = injection memo page. A hit needs a chunk from the question's own document on an expected page; FAQ chunks never count.",
    "",
  );
  return lines.join("\n");
}

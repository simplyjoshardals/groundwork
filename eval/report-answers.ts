import {
  summarizeAnswers,
  type AnswerOutcome,
  type AnswerResult,
  type AnswerSummary,
} from "./score-answers";
import type { DocLabel } from "./score-retrieval";

/**
 * Report for the full-pipeline eval (Task 2.8). Unlike the retrieval report it
 * has no results hash: the LLM is not deterministic, so two runs on unchanged
 * data may differ. Compare runs by reading the numbers, not by hashing them.
 */

export interface AnswerReportMeta {
  label: string;
  /** ISO timestamp. */
  generatedAt: string;
  k: number;
  embeddingModel: string;
  llmModel: string;
  refusalThreshold: number;
}

export interface AnswerReport {
  meta: AnswerReportMeta;
  summary: AnswerSummary;
  results: AnswerResult[];
}

export function buildAnswerReport(
  meta: AnswerReportMeta,
  results: readonly AnswerResult[],
): AnswerReport {
  return {
    meta,
    summary: summarizeAnswers(results, meta.k),
    results: [...results],
  };
}

export function renderAnswersJson(report: AnswerReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const DOC_CODE: Record<DocLabel, string> = {
  handbook: "H",
  "injection-memo": "M",
  faq: "F",
  other: "?",
};

const OUTCOME_LABEL: Record<AnswerOutcome, string> = {
  answered: "answered",
  refused_gate1: "refused (gate 1)",
  refused_gate2: "refused (gate 2)",
};

export const METHOD_AND_LIMITATIONS: readonly string[] = [
  "20 questions over one synthetic handbook (plus one memo for the injection case). A single question moves a rate by 5 to 7 points, so treat small differences as noise.",
  'Fact-match is string matching after normalization (case, whitespace, thousands commas, `[n]` markers). A correct paraphrase such as "thirty days" or "9:30" for "09:30" counts as a miss; such answers are listed under manual review with their text.',
  "Citation correctness checks that a cited passage is in the question's own document and on an expected page. It does not check that the claim next to the marker is supported, and it only counts the exact `[n]` form.",
  "Refusal precision and recall treat any refusal (gate #1 or the model's NOT_FOUND) as positive. Recall is over the 5 unanswerable questions; precision is over every refusal, so one false refusal of an answerable question lowers it.",
  "The LLM is not deterministic and each question ran once. The injection case is one question and one run: it shows the case held, not that injection is solved.",
  "Failure causes are rule-based guesses from the scores. They are not confirmed; read the saved answer before trusting one.",
];

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function ratio(part: number, whole: number, value: number | null): string {
  return `${part}/${whole} (${percent(value)})`;
}

function yesNo(value: boolean | null): string {
  return value === null ? "-" : value ? "yes" : "no";
}

function citedCell(result: AnswerResult): string {
  if (result.outcome !== "answered" || !result.answerable) return "-";
  if (result.citations.length === 0) return "none";
  return yesNo(result.citedCorrect);
}

function outcomeCell(result: AnswerResult): string {
  return result.outcome === null ? "ERROR" : OUTCOME_LABEL[result.outcome];
}

export function renderAnswersMarkdown(report: AnswerReport): string {
  const { meta, summary: s, results } = report;
  const lines: string[] = [
    `# Answer eval: ${meta.label}`,
    "",
    `Generated ${meta.generatedAt}. Embedding \`${meta.embeddingModel}\`, LLM \`${meta.llmModel}\`, top-k ${meta.k}, gate #1 threshold ${meta.refusalThreshold}. Not deterministic: no results hash.`,
    "",
  ];

  if (s.errors > 0) {
    lines.push(
      `**INCOMPLETE:** ${s.errors} of ${s.total} questions could not be observed (retrieval or LLM failure after retries). The numbers below cover only the other ${s.scored}.`,
      "",
    );
  }

  lines.push(
    `- **hit@${s.k}: ${ratio(s.hits, s.answerableScored, s.hitAtK)}**, answerable questions with an expected page in the top ${s.k}`,
    `- **Fact-match: ${ratio(s.factMatches, s.answerableScored, s.factMatchRate)}**, answerable questions whose answer contains every expected fact (a refused question counts as a miss)`,
    `- **Citation correctness: ${ratio(s.citedCorrect, s.answeredAnswerable, s.citedCorrectRate)}**, answered answerable questions citing at least one passage on an expected page; every citation correct: ${ratio(s.allCitationsCorrect, s.answeredAnswerable, s.allCitationsCorrectRate)}`,
    `- Uncited answers: ${s.uncitedAnswers}. Answers with an invalid marker: ${s.answersWithInvalidMarkers} (${s.invalidMarkers} markers)`,
    `- **Refusal recall: ${ratio(s.refusedUnanswerable, s.unanswerableScored, s.refusalRecall)}**, unanswerable questions refused (gate #1: ${s.unanswerableRefusedByGate1}, gate #2: ${s.unanswerableRefusedByGate2})`,
    `- **Refusal precision: ${ratio(s.refusedUnanswerable, s.refusalsTotal, s.refusalPrecision)}**, refusals that were of unanswerable questions`,
    `- False refusals of answerable questions: gate #1 ${s.falseRefusals.gate1}, gate #2 ${s.falseRefusals.gate2}`,
    `- Prompt injection: ${s.injection.passed}/${s.injection.scored} passed`,
    ...s.byCategory.map(
      (row) =>
        `- ${row.category}: hit ${row.hits}/${row.scored}, facts ${row.factMatches}/${row.scored}`,
    ),
    `- Needs manual review: ${s.needsReview}`,
    "",
    "| ID | Category | Question | Outcome | Hit | Facts | Cited | Flags |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.category} | ${cell(truncate(result.question, 60))} | ${outcomeCell(result)} | ${yesNo(result.hit)} | ${yesNo(result.factMatch)} | ${citedCell(result)} | ${cell(result.failures.map((failure) => failure.kind).join(", "))} |`,
    );
  }

  lines.push("", "## Failures and manual review", "");
  const flagged = results.filter((result) => result.failures.length > 0);
  if (flagged.length === 0) {
    lines.push("None.", "");
  }
  for (const result of flagged) {
    const pages = result.topK
      .map((passage) => `${DOC_CODE[passage.doc]}${passage.page}`)
      .join(" ");
    lines.push(
      `### ${result.id}: ${cell(truncate(result.question, 90))}`,
      "",
      `- Outcome: ${outcomeCell(result)}${result.error ? ` (${cell(result.error)})` : ""}. Top-${meta.k} pages: ${pages || "none"}. Expected: ${result.expectedPages.length === 0 ? "none" : result.expectedPages.join(", ")}.`,
      ...result.failures.map(
        (failure) => `- **${failure.kind}**: ${failure.hint}`,
      ),
    );
    if (result.answer !== null && (result.needsReview || result.error)) {
      lines.push(
        `- Answer${result.error ? " (partial)" : ""}: "${cell(truncate(result.answer, 300))}"`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Method and limitations",
    "",
    ...METHOD_AND_LIMITATIONS.map((line) => `- ${line}`),
    "",
    "Codes: H = handbook page, F = FAQ virtual page, M = injection memo page.",
    "",
  );
  return lines.join("\n");
}

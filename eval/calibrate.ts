import { z } from "zod";
import { round6 } from "./score-retrieval";

/**
 * Pure threshold calibration for refusal gate #1 (Task 2.3). No I/O, no clock,
 * no randomness, and no API calls: it works on a report that `yarn eval`
 * (Task 2.2) already wrote, so it is cheap and gives the same output every time.
 *
 * Convention used everywhere here and by the gate (Task 2.4): a question is
 * refused when its top-1 similarity is strictly BELOW the threshold.
 */

/** Only the fields calibration reads; anything else in the report is ignored. */
const reportSchema = z.object({
  meta: z.object({
    label: z.string(),
    embeddingModel: z.string(),
    k: z.number().int().positive(),
  }),
  results: z.array(
    z.object({
      id: z.string(),
      answerable: z.boolean(),
      status: z.enum(["ok", "error"]),
      top1Similarity: z.number().min(-1).max(1).nullable(),
    }),
  ),
});

/** The report file is not the shape `yarn eval` writes. */
export class CalibrationInputError extends Error {
  constructor(detail: string) {
    super(`Not a retrieval eval report: ${detail}`);
    this.name = "CalibrationInputError";
  }
}

export interface ScoredQuestion {
  id: string;
  answerable: boolean;
  similarity: number;
}

export interface SkippedQuestion {
  id: string;
  /** `error`: retrieval failed. `no_similarity`: it ran but returned no passage. */
  reason: "error" | "no_similarity";
}

export interface ParsedReport {
  label: string;
  embeddingModel: string;
  k: number;
  scores: ScoredQuestion[];
  skipped: SkippedQuestion[];
}

export function parseRetrievalReport(input: unknown): ParsedReport {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new CalibrationInputError(detail);
  }
  const { meta, results } = parsed.data;
  const scores: ScoredQuestion[] = [];
  const skipped: SkippedQuestion[] = [];
  for (const result of results) {
    if (result.status === "error") {
      skipped.push({ id: result.id, reason: "error" });
    } else if (result.top1Similarity === null) {
      skipped.push({ id: result.id, reason: "no_similarity" });
    } else {
      scores.push({
        id: result.id,
        answerable: result.answerable,
        similarity: result.top1Similarity,
      });
    }
  }
  return {
    label: meta.label,
    embeddingModel: meta.embeddingModel,
    k: meta.k,
    scores,
    skipped,
  };
}

export interface Distribution {
  count: number;
  min: number | null;
  mean: number | null;
  max: number | null;
}

export function describeDistribution(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { count: 0, min: null, mean: null, max: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: round6(Math.min(...values)),
    mean: round6(sum / values.length),
    max: round6(Math.max(...values)),
  };
}

/**
 * Probability that a random answerable question scores higher than a random
 * unanswerable one (ties count half). 1 means perfectly separable, 0.5 means
 * no better than chance. Null when either group is empty.
 */
export function computeAuc(
  answerable: readonly number[],
  unanswerable: readonly number[],
): number | null {
  if (answerable.length === 0 || unanswerable.length === 0) return null;
  let wins = 0;
  for (const a of answerable) {
    for (const u of unanswerable) {
      if (a > u) wins += 1;
      else if (a === u) wins += 0.5;
    }
  }
  return round6(wins / (answerable.length * unanswerable.length));
}

/** The score range both groups reach, or null when they do not overlap. */
export function overlapRange(
  answerable: readonly number[],
  unanswerable: readonly number[],
): { low: number; high: number } | null {
  if (answerable.length === 0 || unanswerable.length === 0) return null;
  const low = Math.max(Math.min(...answerable), Math.min(...unanswerable));
  const high = Math.min(Math.max(...answerable), Math.max(...unanswerable));
  return low <= high ? { low: round6(low), high: round6(high) } : null;
}

export interface SweepRow {
  threshold: number;
  /** Answerable questions that would be refused (bad). */
  falseRefusals: number;
  answerableCount: number;
  /** Unanswerable questions that would be refused (good). */
  caught: number;
  unanswerableCount: number;
}

export function sweepThresholds(
  answerable: readonly number[],
  unanswerable: readonly number[],
  thresholds: readonly number[],
): SweepRow[] {
  return thresholds.map((threshold) => ({
    threshold,
    falseRefusals: answerable.filter((value) => value < threshold).length,
    answerableCount: answerable.length,
    caught: unanswerable.filter((value) => value < threshold).length,
    unanswerableCount: unanswerable.length,
  }));
}

/** 0.60 to 0.76 in steps of 0.01, built from integers so no float noise. */
export function defaultThresholdGrid(): number[] {
  const grid: number[] = [];
  for (let hundredths = 60; hundredths <= 76; hundredths++) {
    grid.push(hundredths / 100);
  }
  return grid;
}

export interface FloorBetween {
  /** Highest unanswerable score that is below every answerable score. */
  unanswerableBelow: number;
  /** Lowest answerable score. */
  answerableMin: number;
  midpoint: number;
}

/**
 * The widest-margin "no false refusal" threshold: halfway between the lowest
 * answerable score and the highest unanswerable score under it. Null when no
 * unanswerable question scores below every answerable one (such a floor would
 * catch nothing) or when a group is empty.
 */
export function floorBetween(
  answerable: readonly number[],
  unanswerable: readonly number[],
): FloorBetween | null {
  if (answerable.length === 0 || unanswerable.length === 0) return null;
  const answerableMin = Math.min(...answerable);
  const below = unanswerable.filter((value) => value < answerableMin);
  if (below.length === 0) return null;
  const unanswerableBelow = Math.max(...below);
  return {
    unanswerableBelow: round6(unanswerableBelow),
    answerableMin: round6(answerableMin),
    midpoint: round6((unanswerableBelow + answerableMin) / 2),
  };
}

export interface ThresholdMargins {
  /** Lowest answerable score minus the threshold. Negative: answerable questions are refused. */
  answerableMargin: number | null;
  /** Threshold minus the highest unanswerable score under it. Null when none is under it. */
  unanswerableMargin: number | null;
}

export function thresholdMargins(
  threshold: number,
  answerable: readonly number[],
  unanswerable: readonly number[],
): ThresholdMargins {
  const below = unanswerable.filter((value) => value < threshold);
  return {
    answerableMargin:
      answerable.length === 0
        ? null
        : round6(Math.min(...answerable) - threshold),
    unanswerableMargin:
      below.length === 0 ? null : round6(threshold - Math.max(...below)),
  };
}

export interface HistogramBin {
  /** Lower edge of the bin, in steps of `binWidth`. */
  from: number;
  answerable: number;
  unanswerable: number;
}

/** Counts per bin, empty bins included between the lowest and highest score. */
export function histogram(
  answerable: readonly number[],
  unanswerable: readonly number[],
  binWidth = 0.02,
): HistogramBin[] {
  const all = [...answerable, ...unanswerable];
  if (all.length === 0) return [];
  // Work in millionths so bin edges are exact integers.
  const width = Math.round(binWidth * 1_000_000);
  const indexOf = (value: number) =>
    Math.floor(Math.round(value * 1e6) / width);
  const first = Math.min(...all.map(indexOf));
  const last = Math.max(...all.map(indexOf));
  const bins: HistogramBin[] = [];
  for (let index = first; index <= last; index++) {
    bins.push({
      from: round6((index * width) / 1_000_000),
      answerable: answerable.filter((value) => indexOf(value) === index).length,
      unanswerable: unanswerable.filter((value) => indexOf(value) === index)
        .length,
    });
  }
  return bins;
}

export interface Calibration {
  answerable: Distribution;
  unanswerable: Distribution;
  overlap: { low: number; high: number } | null;
  auc: number | null;
  floor: FloorBetween | null;
  chosen: SweepRow & ThresholdMargins;
  sweep: SweepRow[];
  bins: HistogramBin[];
}

export function calibrate(
  scores: readonly ScoredQuestion[],
  chosenThreshold: number,
  grid: readonly number[] = defaultThresholdGrid(),
): Calibration {
  const answerable = scores
    .filter((s) => s.answerable)
    .map((s) => s.similarity);
  const unanswerable = scores
    .filter((s) => !s.answerable)
    .map((s) => s.similarity);
  const [chosenRow] = sweepThresholds(answerable, unanswerable, [
    chosenThreshold,
  ]);
  return {
    answerable: describeDistribution(answerable),
    unanswerable: describeDistribution(unanswerable),
    overlap: overlapRange(answerable, unanswerable),
    auc: computeAuc(answerable, unanswerable),
    floor: floorBetween(answerable, unanswerable),
    chosen: {
      ...chosenRow,
      ...thresholdMargins(chosenThreshold, answerable, unanswerable),
    },
    sweep: sweepThresholds(answerable, unanswerable, grid),
    bins: histogram(answerable, unanswerable),
  };
}

export interface RenderContext {
  chosenThreshold: number;
  /** Model the threshold in `lib/config.ts` was calibrated for. */
  thresholdModel: string;
}

function fixed(value: number | null, digits = 4): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function statsLine(label: string, stats: Distribution): string {
  return `- ${label}: n=${stats.count}, min ${fixed(stats.min)}, mean ${fixed(
    stats.mean,
  )}, max ${fixed(stats.max)}`;
}

export function renderCalibrationMarkdown(
  report: ParsedReport,
  calibration: Calibration,
  context: RenderContext,
): string {
  const { chosen } = calibration;
  const lines: string[] = [
    `# Refusal threshold calibration: ${report.label}`,
    "",
    `Source: retrieval eval \`${report.label}\`, model \`${report.embeddingModel}\`, top-k ${report.k}. Rule: refuse when top-1 similarity is below the threshold.`,
    "",
  ];

  if (report.skipped.length > 0) {
    lines.push(
      `**INCOMPLETE:** ${report.skipped.length} question(s) had no usable top-1 similarity (${report.skipped
        .map((q) => `${q.id}: ${q.reason}`)
        .join(", ")}). The numbers below cover only the others.`,
      "",
    );
  }
  if (report.embeddingModel !== context.thresholdModel) {
    lines.push(
      `**MODEL MISMATCH:** this report used \`${report.embeddingModel}\`, but the configured threshold was calibrated for \`${context.thresholdModel}\`. Similarity scores are model-specific; recalibrate before relying on it.`,
      "",
    );
  }

  lines.push(
    statsLine("top-1 similarity, answerable", calibration.answerable),
    statsLine("top-1 similarity, unanswerable", calibration.unanswerable),
    calibration.overlap
      ? `- overlap: ${fixed(calibration.overlap.low)} to ${fixed(calibration.overlap.high)}, so no threshold separates the two groups`
      : "- overlap: none, the groups are separable",
    `- AUC: ${fixed(calibration.auc, 3)} (1.0 is perfect separation, 0.5 is chance)`,
    calibration.floor
      ? `- widest no-false-refusal floor: ${fixed(calibration.floor.midpoint)}, halfway between the highest unanswerable score under every answerable one (${fixed(calibration.floor.unanswerableBelow)}) and the lowest answerable score (${fixed(calibration.floor.answerableMin)})`
      : "- widest no-false-refusal floor: none (no unanswerable question scores below every answerable one)",
    "",
    `## Configured threshold: ${context.chosenThreshold}`,
    "",
    `- answerable questions refused (false refusals): ${chosen.falseRefusals}/${chosen.answerableCount}`,
    `- unanswerable questions refused by gate #1: ${chosen.caught}/${chosen.unanswerableCount}; the rest must be handled by gate #2 (Task 2.5)`,
    `- margin to the lowest answerable score: ${fixed(chosen.answerableMargin)}`,
    `- margin to the highest unanswerable score under the threshold: ${fixed(chosen.unanswerableMargin)}`,
    "",
    "## Threshold sweep",
    "",
    "| Threshold | False refusals (answerable) | Caught (unanswerable) |",
    "| --- | --- | --- |",
    ...calibration.sweep.map(
      (row) =>
        `| ${row.threshold.toFixed(2)} | ${row.falseRefusals}/${row.answerableCount} | ${row.caught}/${row.unanswerableCount} |`,
    ),
    "",
    "## Distribution (bins of 0.02; A = answerable, U = unanswerable)",
    "",
    "```",
    ...calibration.bins.map((bin) =>
      `${bin.from.toFixed(2)}  ${"A"
        .repeat(bin.answerable)
        .padEnd(
          calibration.answerable.count,
        )}  ${"U".repeat(bin.unanswerable)}`.trimEnd(),
    ),
    "```",
    "",
    "Limits: few questions (see the counts above) and one document, so every number here is an estimate; the real distributions will be wider.",
    "",
  );
  return lines.join("\n");
}

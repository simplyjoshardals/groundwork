import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CalibrationInputError,
  calibrate,
  computeAuc,
  defaultThresholdGrid,
  describeDistribution,
  floorBetween,
  histogram,
  overlapRange,
  parseRetrievalReport,
  renderCalibrationMarkdown,
  sweepThresholds,
  thresholdMargins,
  type ParsedReport,
  type ScoredQuestion,
} from "@/eval/calibrate";
import {
  REFUSAL_SIMILARITY_THRESHOLD,
  REFUSAL_THRESHOLD_EMBEDDING_MODEL,
} from "@/lib/config";

const result = (
  id: string,
  answerable: boolean,
  top1Similarity: number | null,
  status: "ok" | "error" = "ok",
) => ({ id, answerable, status, top1Similarity });

const report = (results: unknown[], model = "m1") => ({
  meta: { label: "t", embeddingModel: model, k: 6, generatedAt: "x" },
  summary: { ignored: true },
  results,
});

describe("parseRetrievalReport", () => {
  it("splits scored, errored and similarity-less questions", () => {
    const parsed = parseRetrievalReport(
      report([
        result("Q1", true, 0.8),
        result("Q2", false, 0.6),
        result("Q3", true, null, "error"),
        result("Q4", false, null),
      ]),
    );
    expect(parsed.scores).toEqual([
      { id: "Q1", answerable: true, similarity: 0.8 },
      { id: "Q2", answerable: false, similarity: 0.6 },
    ]);
    expect(parsed.skipped).toEqual([
      { id: "Q3", reason: "error" },
      { id: "Q4", reason: "no_similarity" },
    ]);
    expect(parsed.label).toBe("t");
    expect(parsed.embeddingModel).toBe("m1");
    expect(parsed.k).toBe(6);
  });

  it.each([
    ["null", null],
    ["a string", "report"],
    ["missing results", { meta: { label: "t", embeddingModel: "m", k: 6 } }],
    ["missing meta", { results: [] }],
    ["similarity above 1", report([result("Q1", true, 1.5)])],
    ["similarity as text", report([result("Q1", true, "0.7" as never)])],
    ["unknown status", report([{ ...result("Q1", true, 0.7), status: "meh" }])],
  ])("rejects %s with a typed error", (_name, input) => {
    expect(() => parseRetrievalReport(input)).toThrow(CalibrationInputError);
  });
});

describe("statistics", () => {
  it("describes a distribution and an empty one", () => {
    expect(describeDistribution([0.6, 0.7, 0.8])).toEqual({
      count: 3,
      min: 0.6,
      mean: 0.7,
      max: 0.8,
    });
    expect(describeDistribution([])).toEqual({
      count: 0,
      min: null,
      mean: null,
      max: null,
    });
  });

  it("computes AUC for separated, reversed, tied and empty groups", () => {
    expect(computeAuc([0.8, 0.9], [0.1, 0.2])).toBe(1);
    expect(computeAuc([0.1, 0.2], [0.8, 0.9])).toBe(0);
    expect(computeAuc([0.5], [0.5])).toBe(0.5);
    expect(computeAuc([], [0.5])).toBeNull();
    expect(computeAuc([0.5], [])).toBeNull();
  });

  it("finds the overlap range, or null when the groups are apart", () => {
    expect(overlapRange([0.67, 0.8], [0.63, 0.71])).toEqual({
      low: 0.67,
      high: 0.71,
    });
    expect(overlapRange([0.8, 0.9], [0.1, 0.2])).toBeNull();
    expect(overlapRange([], [0.2])).toBeNull();
  });
});

describe("sweepThresholds", () => {
  it("refuses strictly below the threshold, so an equal score is kept", () => {
    const [row] = sweepThresholds([0.65, 0.7], [0.6, 0.65], [0.65]);
    expect(row).toEqual({
      threshold: 0.65,
      falseRefusals: 0,
      answerableCount: 2,
      caught: 1,
      unanswerableCount: 2,
    });
  });

  it("counts false refusals and catches at several thresholds", () => {
    const rows = sweepThresholds([0.7, 0.8], [0.6, 0.75], [0.5, 0.72, 0.9]);
    expect(rows.map((r) => [r.falseRefusals, r.caught])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("builds a 0.60 to 0.76 grid without float noise", () => {
    const grid = defaultThresholdGrid();
    expect(grid).toHaveLength(17);
    expect(grid[0]).toBe(0.6);
    expect(grid[5]).toBe(0.65);
    expect(grid[16]).toBe(0.76);
  });
});

describe("floorBetween and thresholdMargins", () => {
  it("is halfway between the highest unanswerable below every answerable and the lowest answerable", () => {
    expect(floorBetween([0.67, 0.8], [0.62, 0.66, 0.7])).toEqual({
      unanswerableBelow: 0.66,
      answerableMin: 0.67,
      midpoint: 0.665,
    });
  });

  it("is null when nothing unanswerable sits below the answerable scores, or a group is empty", () => {
    expect(floorBetween([0.6, 0.8], [0.7])).toBeNull();
    expect(floorBetween([], [0.5])).toBeNull();
    expect(floorBetween([0.7], [])).toBeNull();
  });

  it("reports margins on both sides of a threshold", () => {
    const margins = thresholdMargins(0.65, [0.67, 0.8], [0.62, 0.7]);
    expect(margins.answerableMargin).toBeCloseTo(0.02, 6);
    expect(margins.unanswerableMargin).toBeCloseTo(0.03, 6);
  });

  it("gives a negative answerable margin when answerable questions would be refused, and null with nothing under the threshold", () => {
    expect(thresholdMargins(0.9, [0.7], [0.95]).answerableMargin).toBeCloseTo(
      -0.2,
      6,
    );
    expect(thresholdMargins(0.5, [0.7], [0.95]).unanswerableMargin).toBeNull();
    expect(thresholdMargins(0.5, [], [0.4]).answerableMargin).toBeNull();
  });
});

describe("histogram", () => {
  it("counts per 0.02 bin and keeps empty bins in between", () => {
    const bins = histogram([0.671, 0.755], [0.628, 0.634]);
    expect(bins[0]).toEqual({ from: 0.62, answerable: 0, unanswerable: 2 });
    expect(bins.find((b) => b.from === 0.66)).toEqual({
      from: 0.66,
      answerable: 1,
      unanswerable: 0,
    });
    expect(bins.find((b) => b.from === 0.7)).toEqual({
      from: 0.7,
      answerable: 0,
      unanswerable: 0,
    });
    expect(bins.at(-1)?.from).toBe(0.74);
  });

  it("puts a value exactly on an edge into the bin that starts there", () => {
    expect(histogram([0.7], [])).toEqual([
      { from: 0.7, answerable: 1, unanswerable: 0 },
    ]);
  });

  it("returns nothing for no scores", () => {
    expect(histogram([], [])).toEqual([]);
  });
});

describe("renderCalibrationMarkdown", () => {
  const scores: ScoredQuestion[] = [
    { id: "Q1", answerable: true, similarity: 0.8 },
    { id: "Q2", answerable: true, similarity: 0.67 },
    { id: "Q3", answerable: false, similarity: 0.63 },
    { id: "Q4", answerable: false, similarity: 0.71 },
  ];
  const parsed = (extra: Partial<ParsedReport> = {}): ParsedReport => ({
    label: "t",
    embeddingModel: "m1",
    k: 6,
    scores,
    skipped: [],
    ...extra,
  });
  const context = { chosenThreshold: 0.65, thresholdModel: "m1" };

  it("states the overlap, the configured threshold's effect and the limits", () => {
    const md = renderCalibrationMarkdown(
      parsed(),
      calibrate(scores, 0.65),
      context,
    );
    expect(md).toContain("# Refusal threshold calibration: t");
    expect(md).toContain("overlap: 0.6700 to 0.7100");
    expect(md).toContain("false refusals): 0/2");
    expect(md).toContain("refused by gate #1: 1/2");
    expect(md).toContain("| 0.65 | 0/2 | 1/2 |");
    expect(md).toContain("Limits:");
    expect(md).not.toContain("INCOMPLETE");
    expect(md).not.toContain("MODEL MISMATCH");
  });

  it("flags skipped questions and a model mismatch", () => {
    const md = renderCalibrationMarkdown(
      parsed({
        embeddingModel: "m2",
        skipped: [{ id: "Q9", reason: "error" }],
      }),
      calibrate(scores, 0.65),
      context,
    );
    expect(md).toContain("**INCOMPLETE:** 1 question(s)");
    expect(md).toContain("Q9: error");
    expect(md).toContain("**MODEL MISMATCH:**");
  });

  it("says so when the groups are separable", () => {
    const apart: ScoredQuestion[] = [
      { id: "Q1", answerable: true, similarity: 0.8 },
      { id: "Q2", answerable: false, similarity: 0.5 },
    ];
    const md = renderCalibrationMarkdown(
      parsed({ scores: apart }),
      calibrate(apart, 0.65),
      context,
    );
    expect(md).toContain("overlap: none, the groups are separable");
  });

  it("does not throw with an empty group", () => {
    const only: ScoredQuestion[] = [
      { id: "Q1", answerable: true, similarity: 0.8 },
    ];
    const md = renderCalibrationMarkdown(
      parsed({ scores: only }),
      calibrate(only, 0.65),
      context,
    );
    expect(md).toContain("AUC: n/a");
    expect(md).toContain("floor: none");
  });
});

describe("configured refusal threshold", () => {
  it("is a similarity between 0 and 1 for the calibrated model", () => {
    expect(REFUSAL_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(REFUSAL_SIMILARITY_THRESHOLD).toBeLessThan(1);
    expect(REFUSAL_THRESHOLD_EMBEDDING_MODEL).toBe("gemini-embedding-2");
  });

  // Guards the calibration itself: if the committed baseline is regenerated and
  // the distributions move, this fails and the threshold has to be revisited.
  it("sits between the lowest unanswerable and lowest answerable score of the committed baseline", () => {
    const file = path.join(
      process.cwd(),
      "eval",
      "results",
      "retrieval-baseline.json",
    );
    const parsed = parseRetrievalReport(JSON.parse(readFileSync(file, "utf8")));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.embeddingModel).toBe(REFUSAL_THRESHOLD_EMBEDDING_MODEL);

    const result = calibrate(parsed.scores, REFUSAL_SIMILARITY_THRESHOLD);
    expect(result.answerable.count).toBe(15);
    expect(result.unanswerable.count).toBe(5);
    expect(result.chosen.falseRefusals).toBe(0);
    expect(result.chosen.caught).toBeGreaterThan(0);
    expect(result.chosen.answerableMargin).toBeGreaterThan(0.01);
    expect(result.chosen.unanswerableMargin).toBeGreaterThan(0.01);
    // The recorded finding: the groups overlap, so gate #1 cannot do it alone.
    expect(result.overlap).toEqual({ low: 0.670512, high: 0.714225 });
  });
});
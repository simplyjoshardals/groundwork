import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkRefusalGate1 } from "@/features/qa/refusal";
import {
  REFUSAL_SIMILARITY_THRESHOLD,
  REFUSAL_THRESHOLD_EMBEDDING_MODEL,
} from "@/lib/config";
import { GEMINI_EMBEDDING_MODEL } from "@/lib/providers";

const rows = (...similarities: number[]) =>
  similarities.map((similarity) => ({ similarity }));

describe("checkRefusalGate1", () => {
  it("refuses when the best similarity is below the threshold", () => {
    expect(checkRefusalGate1(rows(0.6, 0.64))).toEqual({
      refuse: true,
      reason: "below_threshold",
      bestSimilarity: 0.64,
    });
  });

  it("passes at exactly the threshold (strict `<`) and above it", () => {
    expect(checkRefusalGate1(rows(REFUSAL_SIMILARITY_THRESHOLD))).toEqual({
      refuse: false,
      bestSimilarity: REFUSAL_SIMILARITY_THRESHOLD,
    });
    expect(checkRefusalGate1(rows(0.8)).refuse).toBe(false);
  });

  it("uses the best score whatever the row order", () => {
    expect(checkRefusalGate1(rows(0.5, 0.9, 0.6))).toEqual({
      refuse: false,
      bestSimilarity: 0.9,
    });
  });

  it("refuses when nothing was retrieved", () => {
    expect(checkRefusalGate1([])).toEqual({
      refuse: true,
      reason: "no_passages",
      bestSimilarity: null,
    });
  });

  it("fails closed on non-finite scores, ignoring them when others are usable", () => {
    expect(checkRefusalGate1(rows(Number.NaN)).refuse).toBe(true);
    expect(checkRefusalGate1(rows(Number.NaN, Infinity)).refuse).toBe(true);
    expect(checkRefusalGate1(rows(Number.NaN, 0.7))).toEqual({
      refuse: false,
      bestSimilarity: 0.7,
    });
  });

  it("accepts an explicit threshold", () => {
    expect(checkRefusalGate1(rows(0.7), 0.75).refuse).toBe(true);
    expect(checkRefusalGate1(rows(0.7), 0.7).refuse).toBe(false);
  });
});

describe("threshold calibration guard", () => {
  it("the threshold was calibrated for the embedding model the app uses", () => {
    expect(GEMINI_EMBEDDING_MODEL).toBe(REFUSAL_THRESHOLD_EMBEDDING_MODEL);
  });
});

interface BaselineRow {
  id: string;
  answerable: boolean;
  top1Similarity: number;
}

function isBaselineRow(value: unknown): value is BaselineRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.answerable === "boolean" &&
    typeof row.top1Similarity === "number"
  );
}

function loadBaseline(): BaselineRow[] {
  const report: unknown = JSON.parse(
    readFileSync("eval/results/retrieval-baseline.json", "utf8"),
  );
  const results =
    typeof report === "object" && report !== null && "results" in report
      ? (report as { results: unknown }).results
      : null;
  if (!Array.isArray(results) || !results.every(isBaselineRow)) {
    throw new Error("retrieval-baseline.json has an unexpected shape.");
  }
  return results;
}

describe("gate #1 on the committed Task 2.2 baseline", () => {
  const baseline = loadBaseline();
  const refused = (answerable: boolean) =>
    baseline
      .filter(
        (row) =>
          row.answerable === answerable &&
          checkRefusalGate1(rows(row.top1Similarity)).refuse,
      )
      .map((row) => row.id);

  it("refuses no answerable question", () => {
    expect(refused(true)).toEqual([]);
  });

  // Q16, Q17, Q19 and Q20 pass gate #1 and are left to gate #2 (Task 2.5,
  // measured in Task 2.8). If the baseline is re-run and this changes, the
  // threshold needs a new calibration (`yarn eval:calibrate`).
  it("refuses only Q18 among the unanswerable questions", () => {
    expect(refused(false)).toEqual(["Q18"]);
  });
});

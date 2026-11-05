/**
 * Refusal-threshold calibration (Task 2.3).
 *
 *   yarn eval:calibrate                   reads eval/results/retrieval-baseline.json
 *   yarn eval:calibrate --label run2      reads eval/results/retrieval-run2.json
 *
 * Reads a report that `yarn eval` already wrote, compares the top-1 similarity
 * of answerable and unanswerable questions against the threshold configured
 * in `lib/config.ts`, and writes eval/results/threshold-<label>.md. Makes no
 * API calls and needs no env file, so it is free to re-run.
 *
 * Exits 1 when the report is unreadable or incomplete, when either group has
 * no scored question, or when the report used a different embedding model than
 * the threshold was calibrated for. Overlapping distributions are a finding,
 * not a failure: they are reported, and the exit code stays 0.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REFUSAL_SIMILARITY_THRESHOLD,
  REFUSAL_THRESHOLD_EMBEDDING_MODEL,
} from "@/lib/config";
import {
  calibrate,
  parseRetrievalReport,
  renderCalibrationMarkdown,
} from "./calibrate";

const RESULTS_DIR = path.join(process.cwd(), "eval", "results");
const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
}

function parseArgs(argv: readonly string[]): { label: string } {
  let label = "baseline";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--label") {
      const value = argv[++i];
      if (value === undefined || !LABEL_PATTERN.test(value)) {
        throw new Error(
          "--label needs a value of lowercase letters, digits and hyphens (up to 40 characters).",
        );
      }
      label = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { label };
}

async function readReport(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `Cannot read ${path.relative(process.cwd(), file)}. Run \`yarn eval --label <label>\` first.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path.relative(process.cwd(), file)} is not valid JSON.`);
  }
}

async function main(): Promise<boolean> {
  const { label } = parseArgs(process.argv.slice(2));
  const report = parseRetrievalReport(
    await readReport(path.join(RESULTS_DIR, `retrieval-${label}.json`)),
  );
  const calibration = calibrate(report.scores, REFUSAL_SIMILARITY_THRESHOLD);
  const markdown = renderCalibrationMarkdown(report, calibration, {
    chosenThreshold: REFUSAL_SIMILARITY_THRESHOLD,
    thresholdModel: REFUSAL_THRESHOLD_EMBEDDING_MODEL,
  });

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `threshold-${label}.md`);
  await writeFile(out, markdown);

  const { chosen } = calibration;
  console.log(
    `answerable n=${calibration.answerable.count} (min ${calibration.answerable.min}) | unanswerable n=${calibration.unanswerable.count} (max ${calibration.unanswerable.max}) | AUC ${calibration.auc}`,
  );
  console.log(
    `threshold ${REFUSAL_SIMILARITY_THRESHOLD}: false refusals ${chosen.falseRefusals}/${chosen.answerableCount}, caught ${chosen.caught}/${chosen.unanswerableCount}`,
  );
  console.log(`wrote ${path.relative(process.cwd(), out)}`);

  let ok = true;
  if (report.skipped.length > 0) {
    console.error(
      `report is incomplete: ${report.skipped.length} question(s) skipped`,
    );
    ok = false;
  }
  if (
    calibration.answerable.count === 0 ||
    calibration.unanswerable.count === 0
  ) {
    console.error("both groups need at least one scored question");
    ok = false;
  }
  if (report.embeddingModel !== REFUSAL_THRESHOLD_EMBEDDING_MODEL) {
    console.error(
      `report model ${report.embeddingModel} differs from the calibrated model ${REFUSAL_THRESHOLD_EMBEDDING_MODEL}`,
    );
    ok = false;
  }
  return ok;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error(`calibration failed: ${describe(error)}`);
    process.exitCode = 1;
  });

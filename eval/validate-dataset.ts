/**
 * Validates eval/dataset/qa.json (Task 2.1).
 *
 *   yarn eval:validate
 *
 * Loads the file with the zod schema, then cross-checks every handbook entry
 * against eval/dataset/facts.md. Needs no env file, database or network.
 * Exit code 0 when everything agrees, 1 otherwise.
 */
import {
  EVAL_CATEGORIES,
  EvalDatasetError,
  loadEvalDataset,
} from "@/eval/dataset";
import { checkAgainstFacts, loadHandbookFacts } from "@/eval/facts";

async function main(): Promise<void> {
  const entries = await loadEvalDataset();
  const problems = checkAgainstFacts(entries, await loadHandbookFacts());
  if (problems.length > 0) {
    throw new EvalDatasetError(
      "qa.json disagrees with facts.md:",
      problems.map((problem) => `  ${problem}`),
    );
  }

  const answerable = entries.filter((entry) => entry.answerable).length;
  const perCategory = EVAL_CATEGORIES.map(
    (category) =>
      `${category} ${entries.filter((e) => e.category === category).length}`,
  ).join(", ");
  console.log(
    `OK: ${entries.length} entries (${answerable} answerable, ${entries.length - answerable} unanswerable). ${perCategory}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : `Unexpected error: ${String(error)}`,
  );
  process.exitCode = 1;
});

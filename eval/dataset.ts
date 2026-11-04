import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MAX_QUESTION_LENGTH } from "@/lib/ask/limits";

/**
 * Eval dataset (Task 2.1): schema and loader for eval/dataset/qa.json.
 *
 * The file keeps the snake_case keys from BUILD_PLAN; the loader returns
 * camelCase entries. `expected_pages` are pages of the entry's `document`
 * (physical PDF pages for the handbook, the single virtual page for the memo),
 * never pages of the FAQ. Not server-only: eval scripts and tests import it.
 */

export const EVAL_DOCUMENTS = ["handbook", "injection-memo"] as const;
export type EvalDocument = (typeof EVAL_DOCUMENTS)[number];

export const EVAL_CATEGORIES = [
  "direct",
  "paraphrase",
  "multi_chunk",
  "unanswerable",
  "injection",
] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const DEFAULT_QA_PATH = path.join(
  process.cwd(),
  "eval",
  "dataset",
  "qa.json",
);

export class EvalDatasetError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length === 0 ? message : `${message}\n${issues.join("\n")}`);
    this.name = "EvalDatasetError";
    this.issues = issues;
  }
}

const text = z.string().trim().min(1);

const entrySchema = z
  .object({
    id: z.string().regex(/^Q\d{2}$/, "must look like Q01"),
    category: z.enum(EVAL_CATEGORIES),
    question: text.max(MAX_QUESTION_LENGTH),
    answerable: z.boolean(),
    document: z.enum(EVAL_DOCUMENTS).optional(),
    fact_ids: z.array(z.string().regex(/^F\d{2}$/, "must look like F01")),
    expected_facts: z.array(text),
    expected_pages: z.array(z.number().int().positive()),
    forbidden_substrings: z.array(text).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const fail = (field: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [field], message });

    if ((entry.category === "unanswerable") === entry.answerable) {
      fail(
        "answerable",
        'must be false exactly when category is "unanswerable"',
      );
    }

    if (!entry.answerable) {
      if (entry.document !== undefined)
        fail("document", "must be omitted for an unanswerable question");
      if (entry.fact_ids.length > 0)
        fail("fact_ids", "must be empty for an unanswerable question");
      if (entry.expected_facts.length > 0)
        fail("expected_facts", "must be empty for an unanswerable question");
      if (entry.expected_pages.length > 0)
        fail("expected_pages", "must be empty for an unanswerable question");
    } else {
      if (entry.document === undefined)
        fail("document", "is required for an answerable question");
      if (entry.expected_facts.length === 0)
        fail("expected_facts", "must not be empty for an answerable question");
      if (entry.expected_pages.length === 0)
        fail("expected_pages", "must not be empty for an answerable question");
    }

    const pages = entry.expected_pages;
    if (pages.some((page, i) => i > 0 && page <= pages[i - 1])) {
      fail("expected_pages", "must be sorted ascending with no duplicates");
    }
    if (new Set(entry.fact_ids).size !== entry.fact_ids.length) {
      fail("fact_ids", "must not contain duplicates");
    }

    if (entry.answerable && entry.document === "handbook") {
      if (entry.fact_ids.length === 0)
        fail("fact_ids", "must list at least one fact for a handbook question");
    }
    if (entry.document === "injection-memo") {
      if (entry.fact_ids.length > 0)
        fail(
          "fact_ids",
          "must be empty for the injection memo (not in facts.md)",
        );
      if (entry.category !== "injection")
        fail("category", 'must be "injection" for the injection memo');
    }

    const forbidden = entry.forbidden_substrings ?? [];
    if (entry.category === "injection") {
      if (entry.document !== "injection-memo")
        fail("document", 'must be "injection-memo" for an injection case');
      if (forbidden.length === 0)
        fail("forbidden_substrings", "must not be empty for an injection case");
    } else if (forbidden.length > 0) {
      fail("forbidden_substrings", "is only allowed on an injection case");
    }
  })
  .transform((entry) => ({
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answerable: entry.answerable,
    document: entry.document ?? null,
    factIds: entry.fact_ids,
    expectedFacts: entry.expected_facts,
    expectedPages: entry.expected_pages,
    forbiddenSubstrings: entry.forbidden_substrings ?? [],
  }));

export type EvalEntry = z.output<typeof entrySchema>;

const datasetSchema = z
  .array(entrySchema)
  .min(1, "the dataset must not be empty")
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `duplicate id ${entry.id}`,
        });
      }
      seen.add(entry.id);
    });
  });

function formatPath(pathParts: readonly PropertyKey[]): string {
  if (pathParts.length === 0) return "(root)";
  return pathParts
    .map((part, i) =>
      typeof part === "number"
        ? `[${part}]`
        : i === 0
          ? String(part)
          : `.${String(part)}`,
    )
    .join("");
}

/** Validates already-parsed JSON. Throws `EvalDatasetError` listing every issue. */
export function parseEvalDataset(json: unknown): EvalEntry[] {
  const result = datasetSchema.safeParse(json);
  if (!result.success) {
    throw new EvalDatasetError(
      "Invalid eval dataset:",
      result.error.issues.map(
        (issue) => `  ${formatPath(issue.path)}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}

/** Reads and validates the dataset file. Every failure is an `EvalDatasetError`. */
export async function loadEvalDataset(
  filePath: string = DEFAULT_QA_PATH,
): Promise<EvalEntry[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EvalDatasetError(`Cannot read ${filePath}: ${reason}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EvalDatasetError(`${filePath} is not valid JSON: ${reason}`);
  }
  return parseEvalDataset(json);
}

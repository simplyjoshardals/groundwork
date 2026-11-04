import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalEntry } from "./dataset";

/**
 * Reads the "Handbook facts" table of eval/dataset/facts.md (the ground truth
 * from Task 0.9) and checks eval entries against it. Pure helpers plus one
 * file loader. `tests/unit/sample-docs.test.ts` keeps its own private parser
 * for the same table; this one is deliberately separate so that test stays
 * untouched.
 */

export const DEFAULT_FACTS_PATH = path.join(
  process.cwd(),
  "eval",
  "dataset",
  "facts.md",
);

export interface HandbookFact {
  id: string;
  /** Physical PDF page, 1-based. */
  page: number;
  fact: string;
  type: "single" | "two-paragraph";
}

const HANDBOOK_TABLE_COLUMNS = 5;

function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`facts.md has no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Table body rows as trimmed cells; the header and separator rows are dropped. */
function tableRows(section: string, columns: number): string[][] {
  const rows = section
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .slice(2);
  for (const row of rows) {
    if (row.length !== columns) {
      throw new Error(
        `Expected ${columns} columns, got ${row.length}: ${row.join(" | ")}`,
      );
    }
  }
  return rows;
}

export function parseHandbookFacts(markdown: string): HandbookFact[] {
  const facts = tableRows(
    sectionOf(markdown, "Handbook facts"),
    HANDBOOK_TABLE_COLUMNS,
  ).map(([id, page, fact, , type]): HandbookFact => {
    if (type !== "single" && type !== "two-paragraph") {
      throw new Error(`${id}: unknown fact type "${type}"`);
    }
    const pageNumber = Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new Error(`${id}: invalid page "${page}"`);
    }
    return { id, page: pageNumber, fact, type };
  });
  if (facts.length === 0) throw new Error("facts.md lists no handbook facts");
  return facts;
}

export async function loadHandbookFacts(
  filePath: string = DEFAULT_FACTS_PATH,
): Promise<HandbookFact[]> {
  return parseHandbookFacts(await readFile(filePath, "utf8"));
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Cross-checks handbook entries against the facts table. Returns one message
 * per problem (empty array means everything agrees):
 *  - every `fact_ids` entry exists;
 *  - `expected_pages` is exactly the set of pages of those facts;
 *  - every `expected_facts` string appears in the text of those facts.
 * Entries for other documents are not checked here.
 */
export function checkAgainstFacts(
  entries: readonly EvalEntry[],
  facts: readonly HandbookFact[],
): string[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const problems: string[] = [];

  for (const entry of entries) {
    if (entry.document !== "handbook") continue;

    const linked: HandbookFact[] = [];
    for (const id of entry.factIds) {
      const fact = byId.get(id);
      if (fact === undefined) {
        problems.push(`${entry.id}: fact ${id} is not in facts.md`);
      } else {
        linked.push(fact);
      }
    }
    if (linked.length !== entry.factIds.length) continue;

    const pages = [...new Set(linked.map((fact) => fact.page))].sort(
      (a, b) => a - b,
    );
    if (pages.join(",") !== entry.expectedPages.join(",")) {
      problems.push(
        `${entry.id}: expected_pages [${entry.expectedPages.join(", ")}] but facts ${entry.factIds.join(", ")} are on pages [${pages.join(", ")}]`,
      );
    }

    const factText = normalizeForMatch(linked.map((f) => f.fact).join(" "));
    for (const expected of entry.expectedFacts) {
      if (!factText.includes(normalizeForMatch(expected))) {
        problems.push(
          `${entry.id}: expected fact "${expected}" does not appear in ${entry.factIds.join(", ")}`,
        );
      }
    }
  }
  return problems;
}

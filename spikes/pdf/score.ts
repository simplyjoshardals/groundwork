/**
 * Scores extracted text against known source text (the synthetic fixtures
 * ship a *.expected.json with the fragments of every page, in reading order).
 *
 * Two measures per page:
 *  - recall: share of expected fragments found in the extracted page text;
 *  - inOrder: the found fragments appear in reading order.
 * Whitespace, case and soft hyphens are ignored, because line wrapping
 * legitimately changes them.
 */
import { isRecord, round } from "../provider/util";

export interface ExpectedPage {
  page: number;
  fragments: string[];
}

export interface ExpectedFile {
  file: string;
  kind: string;
  pages: ExpectedPage[];
}

export interface PageScore {
  page: number;
  expected: number;
  found: number;
  recall: number;
  inOrder: boolean;
}

export interface Score {
  pages: PageScore[];
  overallRecall: number;
  allInOrder: boolean;
}

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/­/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function scorePages(
  extractedPages: readonly string[],
  expected: readonly ExpectedPage[],
): Score {
  const pages: PageScore[] = expected.map((expectedPage) => {
    const haystack = normalizeForMatch(
      extractedPages[expectedPage.page - 1] ?? "",
    );
    let found = 0;
    let lastIndex = -1;
    let inOrder = true;
    for (const fragment of expectedPage.fragments) {
      const index = haystack.indexOf(normalizeForMatch(fragment));
      if (index === -1) continue;
      found++;
      if (index < lastIndex) inOrder = false;
      lastIndex = Math.max(lastIndex, index);
    }
    const total = expectedPage.fragments.length;
    return {
      page: expectedPage.page,
      expected: total,
      found,
      recall: total === 0 ? 1 : round(found / total, 3),
      inOrder,
    };
  });
  const expectedTotal = pages.reduce((sum, p) => sum + p.expected, 0);
  const foundTotal = pages.reduce((sum, p) => sum + p.found, 0);
  return {
    pages,
    overallRecall:
      expectedTotal === 0 ? 1 : round(foundTotal / expectedTotal, 3),
    allInOrder: pages.every((p) => p.inOrder),
  };
}

/** Validates the JSON of an *.expected.json file (untrusted input). */
export function parseExpectedFile(value: unknown): ExpectedFile {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    throw new Error("Expected file must be an object with a pages array.");
  }
  const pages: ExpectedPage[] = value.pages.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.page !== "number" ||
      !Number.isInteger(entry.page) ||
      entry.page < 1 ||
      !Array.isArray(entry.fragments) ||
      !entry.fragments.every((f: unknown) => typeof f === "string")
    ) {
      throw new Error("Each expected page needs a page number and fragments.");
    }
    return { page: entry.page, fragments: entry.fragments as string[] };
  });
  return {
    file: typeof value.file === "string" ? value.file : "unknown",
    kind: typeof value.kind === "string" ? value.kind : "unknown",
    pages,
  };
}

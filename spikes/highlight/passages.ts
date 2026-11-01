/**
 * The known passages for the Task 0.7 highlighting spike.
 *
 * Every passage is a fragment from a fixture's existing `*.expected.json`
 * (the ground-truth sentences the PDF was generated from), picked by fixed
 * page and fragment position so the selection is reproducible and not
 * cherry-picked after seeing results.
 *
 * Three fixtures make up the success rate (single column, two column, table).
 * The edge-case fixture is reported separately and is NOT part of the 40% gate.
 */
import edgeExpected from "@/spikes/pdf/fixtures/highlight-edge.expected.json";
import singleExpected from "@/spikes/pdf/fixtures/single-column.expected.json";
import tableExpected from "@/spikes/pdf/fixtures/table.expected.json";
import twoColumnExpected from "@/spikes/pdf/fixtures/two-column.expected.json";

export type FixtureId =
  "single-column" | "two-column" | "table" | "highlight-edge";

export interface Passage {
  id: string;
  fixture: FixtureId;
  /** 1-based page number in the PDF. */
  page: number;
  /** What this passage is meant to exercise. */
  label: string;
  /** The clean passage text, as a chunk or a quote would carry it. */
  text: string;
}

export interface FixtureSpec {
  id: FixtureId;
  fileName: string;
  title: string;
  /** True for the three PDFs that make up the success rate. */
  counted: boolean;
  passages: Passage[];
}

interface ExpectedShape {
  pages: ReadonlyArray<{ page: number; fragments: readonly string[] }>;
}

interface Pick {
  page: number;
  /** 0-based position in that page's fragments. */
  index: number;
  label: string;
}

function pickPassages(
  fixture: FixtureId,
  expected: ExpectedShape,
  picks: readonly Pick[],
): Passage[] {
  return picks.map((pick, n) => {
    const page = expected.pages.find((p) => p.page === pick.page);
    const text = page?.fragments[pick.index];
    if (text === undefined) {
      throw new Error(
        `No fragment ${pick.index} on page ${pick.page} of ${fixture}.`,
      );
    }
    return {
      id: `${fixture}-${n + 1}`,
      fixture,
      page: pick.page,
      label: pick.label,
      text,
    };
  });
}

export const FIXTURES: readonly FixtureSpec[] = [
  {
    id: "single-column",
    fileName: "single-column.pdf",
    title: "Single column",
    counted: true,
    passages: pickPassages("single-column", singleExpected, [
      { page: 1, index: 0, label: "first sentence on the page" },
      { page: 3, index: 3, label: "middle of the page" },
      { page: 5, index: 7, label: "last sentence on the page" },
      { page: 7, index: 5, label: "middle of the page" },
      { page: 10, index: 2, label: "last page" },
    ]),
  },
  {
    id: "two-column",
    fileName: "two-column.pdf",
    title: "Two column",
    counted: true,
    passages: pickPassages("two-column", twoColumnExpected, [
      { page: 1, index: 2, label: "left column, columns written in turn" },
      { page: 1, index: 9, label: "right column, columns written in turn" },
      { page: 2, index: 4, label: "left column, columns written in turn" },
      { page: 3, index: 1, label: "left column, lines interleaved" },
      { page: 4, index: 10, label: "right column, lines interleaved" },
    ]),
  },
  {
    id: "table",
    fileName: "table.pdf",
    title: "Table",
    counted: true,
    passages: pickPassages("table", tableExpected, [
      { page: 1, index: 3, label: "table row" },
      { page: 1, index: 10, label: "table row" },
      { page: 2, index: 5, label: "table row" },
      { page: 2, index: 13, label: "table row" },
      { page: 3, index: 8, label: "table row" },
    ]),
  },
  {
    id: "highlight-edge",
    fileName: "highlight-edge.pdf",
    title: "Edge cases (not counted)",
    counted: false,
    passages: pickPassages("highlight-edge", edgeExpected, [
      { page: 1, index: 0, label: "ligature glyphs, across a line break" },
      { page: 1, index: 1, label: "ligature glyphs, across a line break" },
      { page: 1, index: 2, label: "compound word hyphenated at line end" },
      { page: 1, index: 3, label: "word broken with a hyphen at line end" },
      { page: 1, index: 4, label: "curly quotes and en dashes" },
    ]),
  },
];

export function fixtureForFile(fileName: string): FixtureSpec | null {
  return FIXTURES.find((f) => f.fileName === fileName) ?? null;
}

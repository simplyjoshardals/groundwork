import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Task 0.9: checks the sample documents against eval/dataset/facts.md, so a
 * regenerated PDF or an edited FAQ cannot silently move a fact to another page
 * or make the documents disagree. Page numbers are physical PDF pages.
 */

const SEED_DIR = path.join(process.cwd(), "supabase", "seed");
const PDF_PATH = path.join(SEED_DIR, "kestrel-vane-employee-handbook.pdf");
const FAQ_PATH = path.join(SEED_DIR, "kestrel-vane-faq.md");
const FACTS_PATH = path.join(process.cwd(), "eval", "dataset", "facts.md");

const MAX_PAGES = 30;
const MAX_BYTES = 5 * 1024 * 1024;
/** Provisional scanned-PDF threshold from docs/decisions.md (Task 0.6). */
const MIN_AVG_CHARS_PER_PAGE = 25;
const MIN_FACTS = 25;
const MIN_TWO_PARAGRAPH_FACTS = 3;
const MIN_QUOTE_LENGTH = 12;
/** "Short" FAQ: about three virtual pages of ~4,000 characters at most. */
const MAX_FAQ_CHARS = 12_000;

interface Fact {
  id: string;
  page: number;
  fact: string;
  quotes: string[];
  type: "single" | "two-paragraph";
}

interface FaqLink {
  question: number;
  factIds: string[];
  keyValues: string[];
}

interface FaqOnly {
  question: number;
  quote: string;
}

interface LayoutMarker {
  page: number;
  kind: "table" | "list";
  marker: string;
}

interface NotCovered {
  topic: string;
  terms: string[];
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

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

function splitList(cell: string): string[] {
  return cell.split("//").map((part) => part.trim());
}

function parseFacts(markdown: string): Fact[] {
  return tableRows(sectionOf(markdown, "Handbook facts"), 5).map(
    ([id, page, fact, quote, type]) => {
      if (type !== "single" && type !== "two-paragraph") {
        throw new Error(
          `${id}: type must be single or two-paragraph, got "${type}"`,
        );
      }
      return { id, page: Number(page), fact, quotes: splitList(quote), type };
    },
  );
}

function parseFaqLinks(markdown: string): FaqLink[] {
  return tableRows(sectionOf(markdown, "FAQ restatements"), 3).map(
    ([q, ids, keys]) => ({
      question: Number(q.replace(/^Q/, "")),
      factIds: ids.split(",").map((id) => id.trim()),
      keyValues: splitList(keys),
    }),
  );
}

function parseFaqOnly(markdown: string): FaqOnly[] {
  return tableRows(sectionOf(markdown, "FAQ-only facts"), 3).map(
    ([q, , quote]) => ({
      question: Number(q.replace(/^Q/, "")),
      quote,
    }),
  );
}

function parseLayout(markdown: string): LayoutMarker[] {
  return tableRows(sectionOf(markdown, "Layout: tables and lists"), 3).map(
    ([page, kind, marker]) => {
      if (kind !== "table" && kind !== "list") {
        throw new Error(`Layout kind must be table or list, got "${kind}"`);
      }
      return { page: Number(page), kind, marker };
    },
  );
}

function parseNotCovered(markdown: string): NotCovered[] {
  return tableRows(sectionOf(markdown, "Deliberately not covered"), 3).map(
    ([topic, , terms]) => ({ topic, terms: splitList(terms) }),
  );
}

/** FAQ answers by question number: the text under each "### Qn." heading. */
function parseFaqAnswers(markdown: string): Map<number, string> {
  const answers = new Map<number, string>();
  const parts = markdown.split(/^### Q(\d+)\. .*$/m);
  // parts = [preamble, "1", body1, "2", body2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1].split(/^## .*$/m)[0];
    answers.set(Number(parts[i]), normalize(body));
  }
  return answers;
}

let pdfBytes = 0;
let pages: string[] = [];
let allText = "";
let facts: Fact[] = [];
let faqText = "";
let faqAnswers = new Map<number, string>();
let factsMarkdown = "";

beforeAll(async () => {
  pdfBytes = (await stat(PDF_PATH)).size;
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(PDF_PATH)));
  const result = await extractText(pdf, { mergePages: false });
  pages = result.text.map(normalize);
  allText = pages.join("\n");
  factsMarkdown = await readFile(FACTS_PATH, "utf8");
  facts = parseFacts(factsMarkdown);
  faqText = await readFile(FAQ_PATH, "utf8");
  faqAnswers = parseFaqAnswers(faqText);
});

describe("sample handbook PDF", () => {
  it("is within the product limits", () => {
    expect(pdfBytes).toBeGreaterThan(0);
    expect(pdfBytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(pages.length).toBeLessThanOrEqual(MAX_PAGES);
  });

  it("is about 10 pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(8);
    expect(pages.length).toBeLessThanOrEqual(12);
  });

  it("has selectable text on every page", () => {
    const chars = pages.map((text) => text.replace(/\s/g, "").length);
    const average = chars.reduce((sum, n) => sum + n, 0) / chars.length;
    expect(average).toBeGreaterThanOrEqual(MIN_AVG_CHARS_PER_PAGE);
    for (const count of chars) expect(count).toBeGreaterThan(200);
  });

  it("prints each page number in its footer", () => {
    pages.forEach((text, index) => {
      expect(text).toContain(`Page ${index + 1} of ${pages.length}`);
    });
  });
});

describe("facts.md handbook facts", () => {
  it("lists enough facts with unique, well-formed ids", () => {
    expect(facts.length).toBeGreaterThanOrEqual(MIN_FACTS);
    const ids = facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^F\d{2}$/);
  });

  it("puts every quote on the stated page, exactly once in the whole PDF", () => {
    for (const fact of facts) {
      expect(Number.isInteger(fact.page), `${fact.id} page`).toBe(true);
      expect(fact.page, `${fact.id} page range`).toBeGreaterThanOrEqual(1);
      expect(fact.page, `${fact.id} page range`).toBeLessThanOrEqual(
        pages.length,
      );
      for (const quote of fact.quotes) {
        expect(quote.length, `${fact.id} quote length`).toBeGreaterThanOrEqual(
          MIN_QUOTE_LENGTH,
        );
        expect(
          pages[fact.page - 1],
          `${fact.id} "${quote}" on page ${fact.page}`,
        ).toContain(quote);
        expect(
          countOccurrences(allText, quote),
          `${fact.id} "${quote}" uniqueness`,
        ).toBe(1);
      }
    }
  });

  it("uses one quote for single facts and two ordered quotes for two-paragraph facts", () => {
    for (const fact of facts) {
      if (fact.type === "single") {
        expect(fact.quotes, fact.id).toHaveLength(1);
      } else {
        expect(fact.quotes, fact.id).toHaveLength(2);
        const [first, second] = fact.quotes.map((q) =>
          pages[fact.page - 1].indexOf(q),
        );
        expect(first, `${fact.id} quotes in document order`).toBeLessThan(
          second,
        );
      }
    }
  });

  it("has at least 3 facts that span two adjacent paragraphs", () => {
    const spanning = facts.filter((f) => f.type === "two-paragraph");
    expect(spanning.length).toBeGreaterThanOrEqual(MIN_TWO_PARAGRAPH_FACTS);
  });
});

describe("facts.md layout markers", () => {
  it("finds every marker on its page and covers at least 2 pages", () => {
    const layout = parseLayout(factsMarkdown);
    for (const { page, marker } of layout) {
      expect(pages[page - 1], `marker "${marker}" on page ${page}`).toContain(
        marker,
      );
    }
    expect(new Set(layout.map((m) => m.page)).size).toBeGreaterThanOrEqual(2);
  });
});

describe("sample FAQ", () => {
  it("is short and has questions Q1 to Q12 in order", () => {
    expect(faqText.length).toBeGreaterThan(0);
    expect(faqText.length).toBeLessThanOrEqual(MAX_FAQ_CHARS);
    expect([...faqAnswers.keys()]).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it("repeats handbook key values consistently", () => {
    for (const link of parseFaqLinks(factsMarkdown)) {
      const answer = faqAnswers.get(link.question);
      expect(answer, `Q${link.question} exists`).toBeDefined();
      const linkedPages = link.factIds.map((id) => {
        const fact = facts.find((f) => f.id === id);
        expect(fact, `${id} exists`).toBeDefined();
        return pages[(fact as Fact).page - 1];
      });
      for (const key of link.keyValues) {
        expect(answer, `Q${link.question} contains "${key}"`).toContain(key);
        expect(
          linkedPages.some((text) => text.includes(key)),
          `"${key}" is on a page of ${link.factIds.join(", ")}`,
        ).toBe(true);
      }
    }
  });

  it("keeps FAQ-only facts out of the PDF", () => {
    for (const { question, quote } of parseFaqOnly(factsMarkdown)) {
      expect(
        faqAnswers.get(question),
        `Q${question} contains "${quote}"`,
      ).toContain(quote);
      expect(allText.includes(quote), `"${quote}" must not be in the PDF`).toBe(
        false,
      );
    }
  });
});

describe("deliberately uncovered topics", () => {
  it("lists at least 5 topics and none appears in either document", () => {
    const topics = parseNotCovered(factsMarkdown);
    expect(topics.length).toBeGreaterThanOrEqual(5);
    const corpus = `${allText}\n${normalize(faqText)}`.toLowerCase();
    for (const { topic, terms } of topics) {
      for (const term of terms) {
        expect(
          corpus.includes(term.toLowerCase()),
          `"${term}" (${topic}) must not appear`,
        ).toBe(false);
      }
    }
  });
});

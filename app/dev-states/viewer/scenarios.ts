import type { ChunkPassage, ChunkResult } from "@/lib/documents/get-chunk";
import type {
  ViewerDocument,
  ViewerDocumentResult,
} from "@/lib/documents/get-viewer-document";
import { buildTextPages } from "@/lib/text-viewer/pages";
import type { ViewerSource } from "@/lib/viewer/source";
import type { ViewerLocation } from "@/lib/viewer-url/location";

/**
 * Scripted data for the viewer dev drill (`/dev-states/viewer/<scenario>`), so
 * every state of the viewer can be reached without a backend, a failing
 * network or a slow disk. Dev only: the route is a 404 outside `next dev`.
 * The PDF is `public/dev/viewer-sample.pdf` (4 pages; page 2 repeats one
 * sentence twice, pages 3 and 4 hold the cited passages).
 */

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const TEXT_ID = "22222222-2222-4222-8222-222222222222";
const PDF_URL = "/dev/viewer-sample.pdf";

const PDF_DOC: ViewerDocument = {
  id: DOC_ID,
  title: "Employee handbook",
  storagePath: "dev/viewer-sample.pdf",
  mimeType: "application/pdf",
};

const FAQ_TEXT = [
  "Company FAQ",
  "How much annual leave do I get? Full-time employees receive 26 days of paid annual leave in each leave year, in addition to public holidays.",
  "Can I carry leave over? Up to five days may be carried into the next leave year.",
  "Who do I ask about expenses? Claims go to your manager within 30 days.",
].join("\n\n");
const FAQ_PASSAGE =
  "Full-time employees receive 26 days of paid annual leave in each leave year, in addition to public holidays.";

const TEXT_DOC: ViewerDocument = {
  id: TEXT_ID,
  title: "Company FAQ",
  storagePath: "dev/company-faq.md",
  mimeType: "text/markdown",
};

const PASSAGES = {
  match: {
    id: "101",
    documentId: DOC_ID,
    pageNumber: 3,
    charStart: 0,
    charEnd: 0,
    content:
      "Full-time employees receive 26 days of paid annual leave in each leave year, in addition to public holidays. Leave accrues monthly from the start date.",
  },
  ambiguous: {
    id: "105",
    documentId: DOC_ID,
    pageNumber: 2,
    charStart: 0,
    charEnd: 0,
    content:
      "Please keep this document confidential and do not share it outside the company.",
  },
  missing: {
    id: "106",
    documentId: DOC_ID,
    pageNumber: 2,
    charStart: 0,
    charEnd: 0,
    content: "Employees may bring a pet to the office on Fridays.",
  },
} satisfies Record<string, ChunkPassage>;

/** The text chunk's offsets come from the same normalization the viewer uses. */
function textChunk(shift: number): ChunkPassage {
  const page = buildTextPages(FAQ_TEXT)[0] ?? "";
  const start = page.indexOf(FAQ_PASSAGE) + shift;
  return {
    id: "201",
    documentId: TEXT_ID,
    pageNumber: 1,
    charStart: start,
    charEnd: start + FAQ_PASSAGE.length,
    content: FAQ_PASSAGE,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Counts attempts, not calls. Calls made at (nearly) the same moment count as
 * one attempt: React StrictMode runs effects twice in `next dev`, and the
 * first call's answer is thrown away, so a naive counter would spend a
 * "fails once" on a call nobody sees. A Retry comes much later.
 */
function attemptCounter(): () => number {
  let attempts = 0;
  let lastCallAt = Number.NEGATIVE_INFINITY;
  return () => {
    const now = Date.now();
    if (now - lastCallAt > 200) attempts += 1;
    lastCallAt = now;
    return attempts;
  };
}

interface Config {
  document?: ViewerDocument;
  /** `fail-once` fails the first lookup and succeeds after Retry. */
  documentResult?: "ok" | "not_found" | "fail" | "fail-once";
  chunk?: ChunkPassage | null;
  chunkResult?: "ok" | "not_found" | "fail-once";
  pdfUrl?: "ok" | "fail-once";
  /** Milliseconds added to every call. */
  delay?: number;
}

function scripted(config: Config): ViewerSource {
  const {
    document = PDF_DOC,
    documentResult = "ok",
    chunk = null,
    chunkResult = "ok",
    pdfUrl = "ok",
    delay = 250,
  } = config;
  const documentAttempt = attemptCounter();
  const chunkAttempt = attemptCounter();
  const urlAttempt = attemptCounter();
  return {
    loadDocument: async (): Promise<ViewerDocumentResult> => {
      const attempt = documentAttempt();
      await sleep(delay);
      if (documentResult === "not_found")
        return { ok: false, reason: "not_found" };
      if (documentResult === "fail" || (documentResult === "fail-once" && attempt === 1))
        return { ok: false, reason: "failed" };
      return { ok: true, document };
    },
    loadChunk: async (): Promise<ChunkResult> => {
      const attempt = chunkAttempt();
      await sleep(delay);
      if (chunkResult === "not_found" || chunk === null)
        return { ok: false, reason: "not_found" };
      if (chunkResult === "fail-once" && attempt === 1)
        return { ok: false, reason: "failed" };
      return { ok: true, chunk };
    },
    createPdfUrl: async () => {
      const attempt = urlAttempt();
      await sleep(delay);
      if (pdfUrl === "fail-once" && attempt === 1) {
        return { ok: false, reason: "failed", message: "x" } as const;
      }
      return { ok: true, url: PDF_URL, expiresAt: new Date(Date.now() + 3600_000) } as const;
    },
    loadText: async () => {
      await sleep(delay);
      return { ok: true, text: FAQ_TEXT } as const;
    },
  };
}

export interface Scenario {
  title: string;
  /** What the "Open" button opens. */
  location: ViewerLocation;
  /** A fresh source per drill mount, so Retry counters start at zero. */
  source: () => ViewerSource;
}

const open = (
  page: number,
  chunkId: string | null,
  documentId = DOC_ID,
): ViewerLocation => ({ status: "open", documentId, page, chunkId });

export const SCENARIOS = {
  highlight: {
    title: "PDF page 3, cited passage highlighted (the wipe plays)",
    location: open(3, "101"),
    source: () => scripted({ chunk: PASSAGES.match }),
  },
  fallback: {
    title: "Ambiguous passage on page 2: fallback card, no highlight",
    location: open(2, "105"),
    source: () => scripted({ chunk: PASSAGES.ambiguous }),
  },
  "fallback-missing": {
    title: "Passage not on the page: fallback card",
    location: open(2, "106"),
    source: () => scripted({ chunk: PASSAGES.missing }),
  },
  "other-page": {
    title: "Link opens page 1, passage is on page 3 (note, no highlight)",
    location: open(1, "101"),
    source: () => scripted({ chunk: PASSAGES.match }),
  },
  "no-chunk": {
    title: "Page 2, no cited passage in the link",
    location: open(2, null),
    source: () => scripted({}),
  },
  text: {
    title: "Markdown file, cited passage highlighted",
    location: open(1, "201", TEXT_ID),
    source: () => scripted({ document: TEXT_DOC, chunk: textChunk(0) }),
  },
  "text-fallback": {
    title: "Markdown file, offsets fail the exactness check: fallback card",
    location: open(1, "201", TEXT_ID),
    source: () => scripted({ document: TEXT_DOC, chunk: textChunk(7) }),
  },
  slow: {
    title: "Slow: 2.5 s per call (skeleton, then reserved note line)",
    location: open(3, "101"),
    source: () => scripted({ chunk: PASSAGES.match, delay: 2500 }),
  },
  "lookup-error": {
    title: "Document lookup fails once; Retry succeeds",
    location: open(3, "101"),
    source: () =>
      scripted({ chunk: PASSAGES.match, documentResult: "fail-once" }),
  },
  "lookup-error-hard": {
    title: "Document lookup always fails",
    location: open(3, "101"),
    source: () => scripted({ documentResult: "fail" }),
  },
  "chunk-error": {
    title: "Chunk lookup fails once; Retry succeeds",
    location: open(3, "101"),
    source: () =>
      scripted({ chunk: PASSAGES.match, chunkResult: "fail-once" }),
  },
  "chunk-unavailable": {
    title: "Chunk missing or not readable (note, page still shown)",
    location: open(3, "101"),
    source: () => scripted({ chunkResult: "not_found" }),
  },
  "pdf-error": {
    title: "File URL fails once; Retry succeeds",
    location: open(3, "101"),
    source: () => scripted({ chunk: PASSAGES.match, pdfUrl: "fail-once" }),
  },
  "not-found": {
    title: "Document missing or not yours",
    location: open(3, "101"),
    source: () => scripted({ documentResult: "not_found" }),
  },
  "no-preview": {
    title: "File type with no viewer",
    location: open(1, null),
    source: () =>
      scripted({
        document: { ...PDF_DOC, mimeType: "application/zip" },
      }),
  },
  invalid: {
    title: "Malformed citation link",
    location: { status: "invalid" },
    source: () => scripted({}),
  },
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;

export function isScenario(value: string): value is ScenarioName {
  return Object.hasOwn(SCENARIOS, value);
}
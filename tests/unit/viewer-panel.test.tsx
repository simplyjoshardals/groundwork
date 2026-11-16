// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfViewerProps } from "@/components/pdf-viewer";
import { ViewerPanel } from "@/components/viewer-panel";
import type { ChunkPassage } from "@/lib/documents/get-chunk";
import type { ViewerDocument } from "@/lib/documents/get-viewer-document";
import { buildTextPages } from "@/lib/text-viewer/pages";
import type { ViewerSource } from "@/lib/viewer/source";

// The real PDF viewer needs PDF.js and a canvas. It is replaced by a stub that
// records what the panel hands it, so the panel's own states are what is
// tested here; the viewer itself is covered by the dev drill and Playwright.
const pdf = vi.hoisted(() => ({ props: null as PdfViewerProps | null }));
vi.mock("@/components/pdf-viewer-loader", () => ({
  PdfViewer: (props: PdfViewerProps) => {
    pdf.props = props;
    return <p>PDF stub, page {props.page}</p>;
  },
}));
vi.mock("@/lib/viewer/source", () => ({ realViewerSource: {} }));
vi.mock("@/lib/viewer-prefetch", () => ({}));
vi.mock("@/lib/supabase/browser", () => ({}));

beforeEach(() => {
  pdf.props = null;
});
afterEach(cleanup);

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const pdfDoc: ViewerDocument = {
  id: DOC_ID,
  title: "Employee handbook",
  storagePath: "x.pdf",
  mimeType: "application/pdf",
};
const FAQ = "Company FAQ\n\nFull-time staff get 26 days of leave.\n\nBye.";
const PASSAGE = "Full-time staff get 26 days of leave.";
const textDoc: ViewerDocument = {
  ...pdfDoc,
  title: "Company FAQ",
  storagePath: "faq.md",
  mimeType: "text/markdown",
};

function chunk(overrides: Partial<ChunkPassage> = {}): ChunkPassage {
  return {
    id: "101",
    documentId: DOC_ID,
    pageNumber: 3,
    charStart: 0,
    charEnd: 0,
    content: "Leave accrues monthly.",
    ...overrides,
  };
}

function makeSource(overrides: Partial<ViewerSource> = {}): ViewerSource {
  return {
    loadDocument: async () => ({ ok: true, document: pdfDoc }),
    // Slower than the document lookup, like the real thing: the viewer shows
    // before its passage arrives, and tests must not assume otherwise.
    loadChunk: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { ok: true, chunk: chunk() };
    },
    createPdfUrl: async () => ({ ok: false, reason: "failed", message: "x" }),
    loadText: async () => ({ ok: true, text: FAQ }),
    ...overrides,
  };
}

function renderPanel(
  source: ViewerSource,
  location: { page?: number; chunkId?: string | null } = {},
  onClose = vi.fn(),
) {
  render(
    <ViewerPanel
      location={{
        status: "open",
        documentId: DOC_ID,
        page: location.page ?? 3,
        chunkId: location.chunkId === undefined ? "101" : location.chunkId,
      }}
      onPageChange={() => {}}
      onClose={onClose}
      source={source}
    />,
  );
  return { onClose };
}

describe("ViewerPanel states", () => {
  it("shows a malformed link as an alert and still offers Close", () => {
    const onClose = vi.fn();
    render(
      <ViewerPanel
        location={{ status: "invalid" }}
        onPageChange={() => {}}
        onClose={onClose}
        source={makeSource()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "This citation link isn’t valid.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("announces loading and keeps the toolbar in place, disabled", () => {
    renderPanel(makeSource({ loadDocument: () => new Promise(() => {}) }));
    expect(screen.getByRole("heading").textContent).toContain(
      "Opening the document",
    );
    expect(
      screen
        .getAllByRole("status")
        .some((node) => node.textContent === "Opening the document…"),
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("explains a missing or unreadable document without saying which", async () => {
    renderPanel(
      makeSource({ loadDocument: async () => ({ ok: false, reason: "not_found" }) }),
    );
    expect(
      await screen.findByText(
        "That document isn’t available. It may have been deleted.",
      ),
    ).toBeTruthy();
  });

  it("offers Retry after a failed lookup and recovers", async () => {
    const loadDocument = vi
      .fn<ViewerSource["loadDocument"]>()
      .mockResolvedValueOnce({ ok: false, reason: "failed" })
      .mockResolvedValue({ ok: true, document: pdfDoc });
    renderPanel(makeSource({ loadDocument }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("heading", { name: "Employee handbook" }),
    ).toBeTruthy();
    expect(loadDocument).toHaveBeenCalledTimes(2);
  });

  it("says so for a file type with no viewer", async () => {
    renderPanel(
      makeSource({
        loadDocument: async () => ({
          ok: true,
          document: { ...pdfDoc, mimeType: "application/zip" },
        }),
      }),
    );
    expect(
      await screen.findByText("A preview isn’t available for this file type."),
    ).toBeTruthy();
  });
});

/** Renders a PDF link and waits until the viewer has been given its passage. */
async function renderWithPassage(source: ViewerSource) {
  renderPanel(source);
  await screen.findByText("PDF stub, page 3");
  await waitFor(() => expect(pdf.props?.passage).not.toBeNull());
}

describe("ViewerPanel with a PDF", () => {
  it("hands the viewer the page, the passage and the source", async () => {
    const source = makeSource();
    await renderWithPassage(source);
    expect(pdf.props?.storagePath).toBe("x.pdf");
    expect(pdf.props?.passage).toEqual({
      id: "101",
      pageNumber: 3,
      text: "Leave accrues monthly.",
    });
    expect(pdf.props?.source).toBe(source);
  });

  it("reserves the note line from the start, then reports a highlight", async () => {
    renderPanel(makeSource());
    await screen.findByText("PDF stub, page 3");
    // Before the passage arrives the line is already there, and says so.
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    await waitFor(() => expect(pdf.props?.passage).not.toBeNull());
    act(() => pdf.props?.onHighlightStatus?.({ state: "highlighted" }));
    expect(
      await screen.findByText("The cited passage is highlighted."),
    ).toBeTruthy();
  });

  it("shows the fallback card instead of the note when it cannot pinpoint", async () => {
    await renderWithPassage(makeSource());
    act(() =>
      pdf.props?.onHighlightStatus?.({
        state: "declined",
        reason: "ambiguous",
        pageNumber: 3,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Cited passage, page 3" }),
    ).toBeTruthy();
    expect(screen.getByText("Leave accrues monthly.")).toBeTruthy();
    expect(
      screen.getByText(
        "Shown as text because it couldn’t be pinpointed on the page.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/nothing is highlighted/)).toBeNull();
  });

  it("never highlights a chunk that belongs to another document", async () => {
    renderPanel(
      makeSource({
        loadChunk: async () => ({
          ok: true,
          chunk: chunk({ documentId: "22222222-2222-4222-8222-222222222222" }),
        }),
      }),
    );
    await screen.findByText("PDF stub, page 3");
    expect(pdf.props?.passage).toBeNull();
    expect(
      await screen.findByText(/belongs to a different document/),
    ).toBeTruthy();
  });

  it("explains a chunk that cannot be read and keeps the page", async () => {
    renderPanel(
      makeSource({
        loadChunk: async () => ({ ok: false, reason: "not_found" }),
      }),
    );
    expect(
      await screen.findByText(/passage could not be found/),
    ).toBeTruthy();
    expect(screen.getByText("PDF stub, page 3")).toBeTruthy();
  });

  it("offers Retry when only the chunk lookup failed", async () => {
    const loadChunk = vi
      .fn<ViewerSource["loadChunk"]>()
      .mockResolvedValueOnce({ ok: false, reason: "failed" })
      .mockResolvedValue({ ok: true, chunk: chunk() });
    renderPanel(makeSource({ loadChunk }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loadChunk).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(pdf.props?.passage?.id).toBe("101"),
    );
  });
});

describe("ViewerPanel with a text file", () => {
  function textChunk(shift: number): ChunkPassage {
    const start = (buildTextPages(FAQ)[0] ?? "").indexOf(PASSAGE) + shift;
    return {
      id: "201",
      documentId: DOC_ID,
      pageNumber: 1,
      charStart: start,
      charEnd: start + PASSAGE.length,
      content: PASSAGE,
    };
  }
  const textSource = (shift: number) =>
    makeSource({
      loadDocument: async () => ({ ok: true, document: textDoc }),
      loadChunk: async () => ({ ok: true, chunk: textChunk(shift) }),
    });

  it("marks the cited range as a highlight", async () => {
    renderPanel(textSource(0), { page: 1, chunkId: "201" });
    const mark = await screen.findByText(PASSAGE);
    expect(mark.tagName).toBe("MARK");
    expect(await screen.findByText("Page 1 of 1")).toBeTruthy();
    expect(
      await screen.findByText("The cited passage is highlighted."),
    ).toBeTruthy();
  });

  it("falls back to the passage card when the offsets do not match", async () => {
    renderPanel(textSource(5), { page: 1, chunkId: "201" });
    expect(
      await screen.findByRole("heading", { name: "Cited passage, page 1" }),
    ).toBeTruthy();
    expect(screen.queryByText(PASSAGE, { selector: "mark" })).toBeNull();
  });

  it("shows a failed file load with Retry, in the viewer", async () => {
    const loadText = vi
      .fn<ViewerSource["loadText"]>()
      .mockResolvedValueOnce({ ok: false, reason: "failed" })
      .mockResolvedValue({ ok: true, text: FAQ });
    renderPanel(
      makeSource({
        loadDocument: async () => ({ ok: true, document: textDoc }),
        loadChunk: async () => ({ ok: false, reason: "not_found" }),
        loadText,
      }),
      { page: 1, chunkId: null },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("region", { name: "Document text, page 1" }),
    ).toBeTruthy();
  });
});
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentList } from "@/components/document-list";
import type { PendingUpload } from "@/components/pending-row";
import { ToastProvider } from "@/components/ui/toast";
import {
  DocumentsSourceContext,
  defaultDocumentsSource,
  type DocumentsSource,
} from "@/lib/documents/source";
import type { OwnDocument } from "@/lib/documents/list-own-documents";

let online = true;
vi.mock("@/lib/net/use-online-status", () => ({ useOnlineStatus: () => online }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  online = true;
});
afterEach(cleanup);

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const mk = (id: string, title: string): OwnDocument => ({
  id,
  title,
  originalFilename: `${id}.pdf`,
  status: "ready",
  errorReason: null,
  pageCount: 3,
  chunkCount: 6,
  createdAt: new Date(NOW - 86_400_000).toISOString(),
  processingStartedAt: null,
});

function setup(
  docs: OwnDocument[],
  over: Partial<DocumentsSource> = {},
  pending: PendingUpload | null = null,
) {
  let current = docs;
  const source: DocumentsSource = {
    ...defaultDocumentsSource,
    list: vi.fn(async () => ({ ok: true as const, documents: current })),
    remove: vi.fn(async (id: string) => {
      current = current.filter((d) => d.id !== id);
      return { ok: true as const };
    }),
    ...over,
  };
  render(
    <DocumentsSourceContext value={source}>
      <ToastProvider>
        <DocumentList
          refreshKey={0}
          onCountChange={() => undefined}
          initial={{ ok: true, documents: docs, fetchedAt: NOW }}
          pending={pending}
          aboveList={<p>upload control</p>}
        />
      </ToastProvider>
    </DocumentsSourceContext>,
  );
  return source;
}

describe("DocumentList (U5)", () => {
  it("reads heading, upload control, then rows", () => {
    setup([mk("a", "Alpha")]);
    const heading = screen.getByRole("heading", { name: "Your documents" });
    const above = screen.getByText("upload control");
    const item = screen.getByRole("listitem");
    expect(heading.compareDocumentPosition(above) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(above.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the empty invitation", () => {
    setup([]);
    expect(screen.getByText("Nothing on the shelf yet.")).toBeTruthy();
    expect(screen.getByText(/Answers will cite the exact page/)).toBeTruthy();
  });

  it("deleting removes the row at once, toasts, and moves focus to the heading", async () => {
    setup([mk("a", "Alpha"), mk("b", "Beta")]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(await screen.findByText("Document deleted")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your documents" }));
  });

  it("offline: warns that the list may be stale", () => {
    online = false;
    setup([mk("a", "Alpha")]);
    expect(screen.getByText(/Showing the last list we have/)).toBeTruthy();
  });

  it("shows the file being added as the first row, and not the empty card", () => {
    setup([], {}, { fileName: "new-lease.pdf", documentId: null });
    expect(screen.getByText("new-lease")).toBeTruthy();
    expect(screen.getByText("Uploading")).toBeTruthy();
    expect(screen.queryByText("Nothing on the shelf yet.")).toBeNull();
  });

  it("hands over to the real row once the shelf has it", () => {
    setup([mk("a", "Alpha")], {}, { fileName: "alpha.pdf", documentId: "a" });
    // Only the real row remains: one title, no placeholder badge.
    expect(screen.getAllByText("Alpha")).toHaveLength(1);
    expect(screen.queryByText("Queued")).toBeNull();
  });
});

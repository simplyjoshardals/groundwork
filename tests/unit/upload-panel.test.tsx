// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingUpload } from "@/components/pending-row";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import { UploadPanel } from "@/components/upload-panel";
import { ToastProvider } from "@/components/ui/toast";
import {
  DocumentsSourceContext,
  defaultDocumentsSource,
  type DocumentsSource,
} from "@/lib/documents/source";
import type { RequestIngestResult } from "@/lib/upload/request-ingest";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";
import { DOCUMENT_LIMIT_MESSAGE, UPLOADS_PAUSED_MESSAGE } from "@/lib/upload/limits";

let online = true;
vi.mock("@/lib/net/use-online-status", () => ({
  useOnlineStatus: () => online,
}));

beforeEach(() => {
  online = true;
});
afterEach(cleanup);

const OK = { ok: true as const, documentId: "d1", storagePath: "u/d1", title: "Lease" };

function setup(
  over: Partial<DocumentsSource> = {},
  props: {
    atCap?: boolean;
    onPendingChange?: (p: PendingUpload | null) => void;
    shelf?: OwnDocument[] | null;
    pending?: PendingUpload | null;
  } = {},
) {
  const source: DocumentsSource = {
    ...defaultDocumentsSource,
    upload: vi.fn(async () => OK),
    ingest: vi.fn(async () => ({ status: "ready" as const, pageCount: 2, chunkCount: 4 })),
    ...over,
  };
  render(
    <DocumentsSourceContext value={source}>
      <ToastProvider>
        <UploadPanel
          canUpload
          atCap={props.atCap}
          onPendingChange={props.onPendingChange}
          shelf={props.shelf}
          pending={props.pending}
        />
      </ToastProvider>
    </DocumentsSourceContext>,
  );
  return source;
}

const input = () => screen.getByLabelText("Upload a document") as HTMLInputElement;
const pdf = (name = "lease.pdf") => new File(["x"], name, { type: "application/pdf" });
const pick = (file: File) => fireEvent.change(input(), { target: { files: [file] } });

describe("UploadPanel", () => {
  it("offers the control and always shows the privacy note", () => {
    setup();
    expect(input().disabled).toBe(false);
    expect(screen.getByText(/Don’t upload sensitive documents/)).toBeTruthy();
    expect(input().getAttribute("aria-describedby")).toBeTruthy();
  });

  it("shows progress in the zone, then a toast when the document is ready", async () => {
    let finish: (r: RequestIngestResult) => void = () => undefined;
    setup({
      ingest: vi.fn(
        () => new Promise<RequestIngestResult>((resolve) => (finish = resolve)),
      ),
    });
    pick(pdf());
    expect(await screen.findByText("Processing lease.pdf…")).toBeTruthy();
    expect(input().disabled).toBe(true);
    finish({ status: "ready", pageCount: 2, chunkCount: 4 });
    expect(await screen.findByText("lease.pdf is ready to search.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a danger alert when processing fails", async () => {
    setup({ ingest: vi.fn(async () => ({ status: "failed" as const, reason: "scanned_pdf" as const })) });
    pick(pdf());
    // The banner points at the row; the reason itself is shown once, on the row.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be processed");
    expect(alert.textContent).not.toContain(ingestFailureMessage("scanned_pdf"));
  });

  it("shows a refused file as an alert and never calls ingest", async () => {
    const source = setup({
      upload: vi.fn(async () => ({
        ok: false as const,
        reason: "unsupported_type" as const,
        message: "Only PDF, TXT and Markdown files are supported.",
      })),
    });
    pick(pdf("photo.png"));
    expect((await screen.findByRole("alert")).textContent).toContain("Only PDF");
    expect(source.ingest).not.toHaveBeenCalled();
  });

  it("shows the paused banner and keeps the zone enabled", async () => {
    setup({
      upload: vi.fn(async () => ({
        ok: false as const,
        reason: "budget_exhausted" as const,
        message: UPLOADS_PAUSED_MESSAGE,
      })),
    });
    pick(pdf());
    expect(await screen.findByText(UPLOADS_PAUSED_MESSAGE)).toBeTruthy();
    expect(input().disabled).toBe(false);
  });

  it("at the cap: disables the zone and says why", () => {
    setup({}, { atCap: true });
    expect(input().disabled).toBe(true);
    expect(screen.getByText(DOCUMENT_LIMIT_MESSAGE)).toBeTruthy();
    // The banner says why once; the line under the button keeps the rules.
    expect(screen.queryByText("The shelf is full.")).toBeNull();
  });

  it("offline: disables the zone with a note and ignores a drop", () => {
    online = false;
    const source = setup();
    expect(input().disabled).toBe(true);
    expect(screen.getByText("Uploads need a connection.")).toBeTruthy();
    fireEvent.drop(input().parentElement as HTMLElement, {
      dataTransfer: { types: ["Files"], files: [pdf()] },
    });
    expect(source.upload).not.toHaveBeenCalled();
  });

  it("takes the first of several dropped files and says the rest were skipped", async () => {
    let finish: (r: typeof OK) => void = () => undefined;
    const source = setup({ upload: vi.fn(() => new Promise<typeof OK>((r) => (finish = r))) });
    fireEvent.drop(input().parentElement as HTMLElement, {
      dataTransfer: { types: ["Files"], files: [pdf("a.pdf"), pdf("b.pdf")] },
    });
    expect(await screen.findByText("One file at a time. The others were skipped.")).toBeTruthy();
    expect(source.upload).toHaveBeenCalledTimes(1);
    expect((source.upload as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBe("a.pdf");
    finish(OK);
    await waitFor(() => expect(screen.queryByText("One file at a time. The others were skipped.")).toBeNull());
  });
  it("reports the file being added so the shelf can show a row for it", async () => {
    const calls: Array<PendingUpload | null> = [];
    setup({}, { onPendingChange: (p) => calls.push(p) });
    pick(pdf());
    await waitFor(() => expect(calls.at(-1)).toBeNull());
    expect(calls[0]).toEqual({ fileName: "lease.pdf", documentId: null });
    expect(calls[1]).toEqual({ fileName: "lease.pdf", documentId: "d1" });
  });

  it("clears the pending file when the upload is refused", async () => {
    const calls: Array<PendingUpload | null> = [];
    setup(
      {
        upload: vi.fn(async () => ({
          ok: false as const,
          reason: "unsupported_type" as const,
          message: "Only PDF, TXT and Markdown files are supported.",
        })),
      },
      { onPendingChange: (p) => calls.push(p) },
    );
    pick(pdf("photo.png"));
    await screen.findByRole("alert");
    expect(calls.at(-1)).toBeNull();
  });

  it("takes a file dropped anywhere on the page, and says so while dragging", async () => {
    const source = setup();
    const files = { types: ["Files"], files: [pdf("dropped.pdf")] };
    fireEvent.dragEnter(document.body, { dataTransfer: files });
    expect(await screen.findByText("Drop to shelve it.")).toBeTruthy();
    fireEvent.drop(document.body, { dataTransfer: files });
    await waitFor(() => expect(source.upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Drop to shelve it.")).toBeNull();
  });

  it("does not take a drop while a dialog is open", () => {
    const source = setup();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    fireEvent.drop(document.body, {
      dataTransfer: { types: ["Files"], files: [pdf()] },
    });
    expect(source.upload).not.toHaveBeenCalled();
    dialog.remove();
  });

  const shelfDoc = (id: string, over: Partial<OwnDocument> = {}): OwnDocument => ({
    id,
    title: `Title ${id}`,
    originalFilename: `${id}.pdf`,
    status: "ready",
    errorReason: null,
    pageCount: 4,
    chunkCount: 8,
    createdAt: "2026-11-17T12:00:00.000Z",
    processingStartedAt: null,
    ...over,
  });

  it("counts the shelf under the strip, with a spine for each document", () => {
    setup({}, { shelf: [shelfDoc("a"), shelfDoc("b", { status: "failed", pageCount: null })] });
    expect(screen.getByText("2 of 10 on your shelf")).toBeTruthy();
    expect(screen.getByTitle("Title a")).toBeTruthy();
    expect(screen.getByTitle("Title b")).toBeTruthy();
  });

  it("counts a file on its way as already on the shelf", () => {
    setup({}, { shelf: [shelfDoc("a")], pending: { fileName: "new.pdf", documentId: null } });
    expect(screen.getByText("2 of 10 on your shelf")).toBeTruthy();
  });

  it("says nothing about the count while the shelf is loading", () => {
    setup({}, { shelf: null });
    expect(screen.queryByText(/on your shelf/)).toBeNull();
  });

  it("at the cap the strip is full and the button is disabled", () => {
    const full = Array.from({ length: 10 }, (_, i) => shelfDoc(`d${i}`));
    setup({}, { atCap: true, shelf: full });
    expect(screen.getByText("10 of 10 on your shelf")).toBeTruthy();
    expect(input().disabled).toBe(true);
  });
});

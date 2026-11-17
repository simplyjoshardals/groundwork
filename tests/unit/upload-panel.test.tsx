// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  props: { atCap?: boolean } = {},
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
        <UploadPanel canUpload atCap={props.atCap} />
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
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(ingestFailureMessage("scanned_pdf"));
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
    expect(screen.getByText("The shelf is full.")).toBeTruthy();
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
});

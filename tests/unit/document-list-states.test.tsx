// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ListOwnDocumentsResult,
  OwnDocument,
} from "@/lib/documents/list-own-documents";

const listOwnDocuments = vi.fn<() => Promise<ListOwnDocumentsResult>>();

vi.mock("@/lib/documents/list-own-documents", () => ({
  listOwnDocuments: () => listOwnDocuments(),
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
vi.mock("@/lib/upload/request-ingest", () => ({ requestIngest: vi.fn() }));
vi.mock("@/components/delete-document-button", () => ({
  DeleteDocumentButton: () => null,
}));

import { DocumentList } from "@/components/document-list";

const doc = (overrides: Partial<OwnDocument> = {}): OwnDocument => ({
  id: "d1",
  title: "Lease agreement",
  originalFilename: "lease.pdf",
  status: "ready",
  errorReason: null,
  pageCount: 4,
  chunkCount: 8,
  createdAt: "2026-11-15T08:00:00.000Z",
  processingStartedAt: null,
  ...overrides,
});

beforeEach(() => {
  listOwnDocuments.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DocumentList states", () => {
  it("renders the server's documents at once, with no loading state and no extra read", () => {
    render(
      <DocumentList
        refreshKey={0}
        initial={{ ok: true, documents: [doc()], fetchedAt: Date.now() }}
      />,
    );
    expect(screen.getByText("Lease agreement")).toBeTruthy();
    expect(screen.queryByText("Loading your documents")).toBeNull();
    expect(listOwnDocuments).not.toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    render(
      <DocumentList
        refreshKey={0}
        initial={{ ok: true, documents: [], fetchedAt: Date.now() }}
      />,
    );
    expect(screen.getByText("Nothing on the shelf yet.")).toBeTruthy();
  });

  it("shows a loading state while the first client read is pending (no server data)", () => {
    listOwnDocuments.mockReturnValue(new Promise(() => undefined));
    render(<DocumentList refreshKey={0} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Loading your documents",
    );
  });

  it("shows an error when the server read failed, and Try again loads the list", async () => {
    listOwnDocuments.mockResolvedValue({ ok: true, documents: [doc()] });
    render(<DocumentList refreshKey={0} initial={{ ok: false }} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't load your documents.",
    );
    expect(listOwnDocuments).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.getByText("Lease agreement")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Trying… on Try again while the read is pending, then recovers", async () => {
    let finish: (r: ListOwnDocumentsResult) => void = () => undefined;
    listOwnDocuments.mockReturnValue(
      new Promise<ListOwnDocumentsResult>((resolve) => {
        finish = resolve;
      }),
    );
    render(<DocumentList refreshKey={0} initial={{ ok: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const pending = screen.getByRole("button", { name: "Trying…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      finish({ ok: true, documents: [doc()] });
    });
    expect(screen.getByText("Lease agreement")).toBeTruthy();
  });

  it("keeps the error and re-enables Try again when the retry fails too", async () => {
    listOwnDocuments.mockResolvedValue({ ok: false, reason: "failed" });
    render(<DocumentList refreshKey={0} initial={{ ok: false }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the last list and says so when a refresh fails", async () => {
    vi.useFakeTimers();
    listOwnDocuments.mockResolvedValue({ ok: false, reason: "failed" });
    render(
      <DocumentList
        refreshKey={0}
        initial={{
          ok: true,
          documents: [
            doc({
              status: "processing",
              processingStartedAt: new Date().toISOString(),
            }),
          ],
          fetchedAt: Date.now(),
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(listOwnDocuments).toHaveBeenCalled();
    expect(screen.getByText("Lease agreement")).toBeTruthy();
    expect(
      screen.getByText("Couldn't refresh. Showing the last list we have."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
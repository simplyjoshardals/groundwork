// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import {
  DocumentsSourceContext,
  defaultDocumentsSource,
  type DocumentsSource,
  type RemoveDocumentResult,
} from "@/lib/documents/source";

// jsdom has no modal dialog: a small polyfill, as in the viewer shell tests.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function setup(remove: () => Promise<RemoveDocumentResult>) {
  const onDeleted = vi.fn();
  const source: DocumentsSource = { ...defaultDocumentsSource, remove };
  render(
    <DocumentsSourceContext value={source}>
      <DeleteDocumentButton
        documentId="d1"
        documentTitle="Lease"
        onDeleted={onDeleted}
      />
    </DocumentsSourceContext>,
  );
  return { onDeleted };
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Delete Lease" }));

describe("DeleteDocumentButton", () => {
  it("asks first, with the consequence, and Keep it changes nothing", () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    const { onDeleted } = setup(remove);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(screen.getByRole("dialog", { name: "Delete “Lease”?" })).toBeTruthy();
    // The page scrollbar's width is measured for the scroll lock, and released after.
    expect(document.documentElement.style.getPropertyValue("--scrollbar-w")).not.toBe("");
    expect(screen.getByText(/can’t be undone/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--scrollbar-w")).toBe("");
    expect(remove).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("Escape cancels", () => {
    setup(async () => ({ ok: true }));
    open();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes on confirm and reports it", async () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    const { onDeleted } = setup(remove);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith("d1");
  });

  it("keeps the dialog open with the reason when it fails, and can try again", async () => {
    const remove = vi
      .fn<() => Promise<RemoveDocumentResult>>()
      .mockResolvedValueOnce({
        ok: false,
        kind: "network",
        message: "Could not reach the server. Check your connection and try again.",
      })
      .mockResolvedValueOnce({ ok: true });
    const { onDeleted } = setup(remove);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("disables both buttons while deleting", async () => {
    let finish: (r: RemoveDocumentResult) => void = () => undefined;
    setup(() => new Promise((resolve) => (finish = resolve)));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
    const busy = await screen.findByRole("button", { name: "Deleting…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Keep it" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true });
  });
});

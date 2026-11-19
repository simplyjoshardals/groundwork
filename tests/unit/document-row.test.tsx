// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentRow, STUCK_NOTE } from "@/components/document-row";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import { ingestFailureMessage } from "@/lib/ingest/failure-messages";

afterEach(cleanup);

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const DOC: OwnDocument = {
  id: "d1",
  title: "Lease agreement",
  originalFilename: "lease.pdf",
  status: "ready",
  errorReason: null,
  pageCount: 6,
  chunkCount: 12,
  createdAt: new Date(NOW - 2 * 86_400_000).toISOString(),
  processingStartedAt: null,
};

type RowProps = Omit<Partial<React.ComponentProps<typeof DocumentRow>>, "doc"> & {
  doc?: Partial<OwnDocument>;
};

function row(over: RowProps = {}) {
  const { doc, ...rest } = over;
  render(
    <ul>
      <DocumentRow
        doc={{ ...DOC, ...doc }}
        now={NOW}
        stuck={false}
        retrying={false}
        showRetry={false}
        onRetry={() => undefined}
        deleteAction={<button type="button">Delete</button>}
        {...rest}
      />
    </ul>,
  );
}

describe("DocumentRow", () => {
  it("shows title, status, meta and the delete action", () => {
    row();
    expect(screen.getByRole("listitem")).toBeTruthy();
    expect(screen.getByText("Lease agreement")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("6 pages · PDF · added 2 days ago")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("a failed row shows its reason, and Retry only when allowed", () => {
    row({ doc: { status: "failed", errorReason: "scanned_pdf", pageCount: null } });
    expect(screen.getByText(ingestFailureMessage("scanned_pdf"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("a stuck row says so and offers Retry", () => {
    row({ doc: { status: "processing", pageCount: null }, stuck: true, showRetry: true });
    expect(screen.getByText(STUCK_NOTE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry Lease agreement" })).toBeTruthy();
  });

  it("a retrying row disables Retry and a note replaces the generic text", () => {
    row({
      doc: { status: "processing", pageCount: null },
      stuck: true,
      showRetry: true,
      retrying: true,
      note: "It is still being processed.",
    });
    const retry = screen.getByRole("button", { name: "Retry Lease agreement" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toBe("Retrying…");
    expect(screen.queryByText(STUCK_NOTE)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("It is still being processed.");
  });

  it("tells the shelf strip when it is pointed at or focused", () => {
    const calls: boolean[] = [];
    row({ onActiveChange: (active) => calls.push(active) });
    const item = screen.getByRole("listitem");
    fireEvent.mouseEnter(item);
    fireEvent.mouseLeave(item);
    fireEvent.focus(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toEqual([true, false, true]);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OwnDocument } from "@/lib/documents/list-own-documents";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SampleShelf } from "@/components/sample-shelf";

afterEach(cleanup);

const sample = (id: string, title: string): OwnDocument => ({
  id,
  title,
  originalFilename: `${id}.pdf`,
  status: "ready",
  errorReason: null,
  pageCount: 4,
  chunkCount: 6,
  createdAt: "2026-11-01T00:00:00.000Z",
  processingStartedAt: null,
});

describe("SampleShelf", () => {
  it("lists the samples with a Sample badge and the account explainer", () => {
    render(
      <SampleShelf documents={[sample("a", "Remote work policy"), sample("b", "Router FAQ")]} />,
    );
    expect(screen.getByRole("heading", { name: "Sample documents" })).toBeTruthy();
    expect(screen.getByText("Remote work policy")).toBeTruthy();
    expect(screen.getAllByText("Sample")).toHaveLength(2);
    expect(screen.getByText("Uploading needs an account")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Create an account" })[0]?.getAttribute("href"),
    ).toBe("/sign-up");
  });

  it("says so when the read failed, with Try again, never an empty shelf", () => {
    render(<SampleShelf documents={null} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't load the sample documents.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says when there are no samples", () => {
    render(<SampleShelf documents={[]} />);
    expect(screen.getByText("No sample documents are available right now.")).toBeTruthy();
  });
});

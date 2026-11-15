import { describe, expect, it } from "vitest";
import { toInitialDocuments } from "@/lib/documents/initial-documents";

describe("toInitialDocuments", () => {
  it("stamps a successful read with the given time", () => {
    expect(toInitialDocuments({ ok: true, documents: [] }, 123)).toEqual({
      ok: true,
      documents: [],
      fetchedAt: 123,
    });
  });

  it("keeps a failed read as a failure, never an empty list", () => {
    expect(toInitialDocuments({ ok: false, reason: "failed" }, 123)).toEqual({
      ok: false,
    });
  });
});

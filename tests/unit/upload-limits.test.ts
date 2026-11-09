import { describe, expect, it } from "vitest";
import { MAX_DOCS_PER_USER_HINT } from "@/lib/upload/file-checks";
import {
  DOCUMENT_LIMIT_MESSAGE,
  UPLOADS_PAUSED_MESSAGE,
  classifyInsertError,
  isAtDocumentCap,
} from "@/lib/upload/limits";

describe("isAtDocumentCap", () => {
  it("is true at and above the cap, false below it", () => {
    expect(isAtDocumentCap(MAX_DOCS_PER_USER_HINT - 1)).toBe(false);
    expect(isAtDocumentCap(MAX_DOCS_PER_USER_HINT)).toBe(true);
    expect(isAtDocumentCap(MAX_DOCS_PER_USER_HINT + 1)).toBe(true);
    expect(isAtDocumentCap(0)).toBe(false);
  });

  it("never disables the control on an unknown or invalid count", () => {
    expect(isAtDocumentCap(null)).toBe(false);
    expect(isAtDocumentCap(Number.NaN)).toBe(false);
  });
});

describe("classifyInsertError", () => {
  it("recognises the two trigger errors by their message token", () => {
    expect(classifyInsertError({ message: "document_limit_reached" })).toBe(
      "document_limit_reached",
    );
    expect(classifyInsertError({ message: " storage_budget_exhausted " })).toBe(
      "storage_budget_exhausted",
    );
  });

  it("treats everything else as other", () => {
    expect(classifyInsertError(null)).toBe("other");
    expect(classifyInsertError(undefined)).toBe("other");
    expect(classifyInsertError({})).toBe("other");
    expect(classifyInsertError({ message: 42 })).toBe("other");
    expect(classifyInsertError({ message: "owner_mismatch" })).toBe("other");
    expect(
      classifyInsertError({ message: "xdocument_limit_reached_extra" }),
    ).toBe("other");
  });
});

describe("messages", () => {
  it("are fixed, distinct and say what to do", () => {
    expect(DOCUMENT_LIMIT_MESSAGE).toContain(String(MAX_DOCS_PER_USER_HINT));
    expect(DOCUMENT_LIMIT_MESSAGE).toMatch(/delete/i);
    expect(UPLOADS_PAUSED_MESSAGE).toMatch(/paused/i);
    expect(UPLOADS_PAUSED_MESSAGE).not.toBe(DOCUMENT_LIMIT_MESSAGE);
  });
});

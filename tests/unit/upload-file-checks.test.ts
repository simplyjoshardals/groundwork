import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "@/lib/pdf/limits";
import { isDocumentStoragePath } from "@/lib/storage/documents";
import {
  FALLBACK_TITLE,
  cleanOriginalFilename,
  mimeTypeForFileName,
  safeStorageFileName,
  titleFromFileName,
  validateUploadFile,
} from "@/lib/upload/file-checks";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC = "a1000000-0000-4000-8000-000000000001";

describe("mimeTypeForFileName", () => {
  it("maps the three accepted extensions, ignoring case", () => {
    expect(mimeTypeForFileName("a.pdf")).toBe("application/pdf");
    expect(mimeTypeForFileName("A.PDF")).toBe("application/pdf");
    expect(mimeTypeForFileName("notes.txt")).toBe("text/plain");
    expect(mimeTypeForFileName("README.md")).toBe("text/markdown");
  });

  it("rejects everything else, including a hidden second extension", () => {
    expect(mimeTypeForFileName("setup.exe")).toBeNull();
    expect(mimeTypeForFileName("archive.pdf.exe")).toBeNull();
    expect(mimeTypeForFileName("noextension")).toBeNull();
    expect(mimeTypeForFileName("notes.markdown")).toBeNull();
    expect(mimeTypeForFileName("")).toBeNull();
  });
});

describe("validateUploadFile", () => {
  it("accepts a file at exactly the size limit", () => {
    expect(validateUploadFile({ name: "a.pdf", size: MAX_FILE_BYTES })).toEqual({
      ok: true,
      mimeType: "application/pdf",
    });
  });

  it("rejects a file one byte over the limit", () => {
    const result = validateUploadFile({
      name: "a.pdf",
      size: MAX_FILE_BYTES + 1,
    });
    expect(result).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("rejects an empty file and an unsupported type", () => {
    expect(validateUploadFile({ name: "a.md", size: 0 })).toMatchObject({
      reason: "empty",
    });
    expect(validateUploadFile({ name: "a.exe", size: 10 })).toMatchObject({
      reason: "unsupported_type",
    });
  });

  it("reports the type problem before the size problem", () => {
    expect(
      validateUploadFile({ name: "a.exe", size: MAX_FILE_BYTES + 1 }),
    ).toMatchObject({ reason: "unsupported_type" });
  });
});

describe("safeStorageFileName", () => {
  const cases: Array<[string, string]> = [
    ["report.pdf", "report.pdf"],
    ["Annual Report (final).PDF", "Annual_Report_final.pdf"],
    ["Résumé.pdf", "Resume.pdf"],
    ["a  b---c.md", "a_b---c.md"],
    ["../../etc/passwd.pdf", "etc_passwd.pdf"],
    ["日本語.pdf", "document.pdf"],
    [".pdf", "document.pdf"],
    ["....pdf", "document.pdf"],
    ["notes.txt", "notes.txt"],
  ];

  it.each(cases)("turns %j into %j", (input, expected) => {
    expect(safeStorageFileName(input)).toBe(expected);
  });

  it("always produces a name the storage path rules accept", () => {
    const awkward = [
      "x".repeat(300) + ".pdf",
      "😀😀😀.md",
      "a/b\\c:d*e?.txt",
      "..",
      "\u0000\u0001.pdf",
      "name with\ttab and\nnewline.md",
    ];
    for (const name of awkward) {
      const safe = safeStorageFileName(name);
      expect(safe.length).toBeGreaterThanOrEqual(1);
      expect(safe.length).toBeLessThanOrEqual(100);
      expect(isDocumentStoragePath(`${OWNER}/${DOC}/${safe}`)).toBe(true);
    }
  });

  it("keeps the extension when a long stem is cut", () => {
    const safe = safeStorageFileName("y".repeat(300) + ".md");
    expect(safe).toHaveLength(100);
    expect(safe.endsWith(".md")).toBe(true);
  });
});

describe("cleanOriginalFilename", () => {
  it("strips control characters and surrounding spaces", () => {
    expect(cleanOriginalFilename("  my\u0000 file\u2028.pdf ")).toBe(
      "my file.pdf",
    );
  });

  it("keeps the real name, accents included", () => {
    expect(cleanOriginalFilename("Résumé final.pdf")).toBe("Résumé final.pdf");
  });

  it("cuts a long name to 255 characters and keeps the extension", () => {
    const cleaned = cleanOriginalFilename("z".repeat(400) + ".pdf");
    expect(Array.from(cleaned)).toHaveLength(255);
    expect(cleaned.endsWith(".pdf")).toBe(true);
  });

  it("never splits a surrogate pair when cutting", () => {
    const cleaned = cleanOriginalFilename("😀".repeat(300) + ".md");
    expect(Array.from(cleaned)).toHaveLength(255);
    expect(cleaned).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("titleFromFileName", () => {
  it("drops a known extension", () => {
    expect(titleFromFileName("Annual Report.pdf")).toBe("Annual Report");
    expect(titleFromFileName("faq.MD")).toBe("faq");
  });

  it("keeps dots inside the name", () => {
    expect(titleFromFileName("v1.2 plan.txt")).toBe("v1.2 plan");
  });

  it("falls back when nothing is left", () => {
    expect(titleFromFileName(".pdf")).toBe(FALLBACK_TITLE);
    expect(titleFromFileName("\u0000.md")).toBe(FALLBACK_TITLE);
  });

  it("limits the title to 200 characters", () => {
    expect(Array.from(titleFromFileName("t".repeat(500) + ".pdf"))).toHaveLength(
      200,
    );
  });
});

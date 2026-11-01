import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countChars,
  DEFAULT_MIN_AVG_CHARS_PER_PAGE,
  extractPdf,
  hasPdfMagic,
  isLikelyScanned,
  mapPdfError,
  PdfExtractionError,
} from "@/spikes/pdf/extract";
import { parseTextMode, toPageReports } from "@/spikes/pdf/protocol";
import {
  normalizeForMatch,
  parseExpectedFile,
  scorePages,
} from "@/spikes/pdf/score";

const FIXTURES = path.join(process.cwd(), "spikes", "pdf", "fixtures");

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, name)));
}

function namedError(name: string): Error {
  const error = new Error("library message that must not leak");
  error.name = name;
  return error;
}

describe("magic bytes", () => {
  it("accepts %PDF- near the start, rejects other content", () => {
    expect(hasPdfMagic(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode("junk\n%PDF-1.4"))).toBe(true);
    expect(hasPdfMagic(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBe(false);
    expect(hasPdfMagic(new Uint8Array())).toBe(false);
  });

  it("ignores %PDF- that appears only after the first 1024 bytes", () => {
    const bytes = new Uint8Array(2000).fill(0x20);
    bytes.set(new TextEncoder().encode("%PDF-"), 1500);
    expect(hasPdfMagic(bytes)).toBe(false);
  });
});

describe("scanned-PDF heuristic", () => {
  it("counts non-whitespace characters only", () => {
    expect(countChars(" a b\n\tc  ")).toBe(3);
  });

  it("flags low averages and not high ones", () => {
    expect(isLikelyScanned([0, 0, 0], 25)).toBe(true);
    expect(isLikelyScanned([5, 5, 5], 25)).toBe(true);
    expect(isLikelyScanned([600, 700], 25)).toBe(false);
  });

  it("uses the average, so one blank page does not flag a text file", () => {
    expect(isLikelyScanned([900, 0, 900, 900], 25)).toBe(false);
  });

  it("treats an empty document as scanned", () => {
    expect(isLikelyScanned([], 25)).toBe(true);
  });
});

describe("error mapping", () => {
  it("maps library failures to controlled codes without leaking messages", () => {
    expect(mapPdfError(namedError("PasswordException")).code).toBe("encrypted");
    expect(mapPdfError(namedError("InvalidPDFException")).code).toBe("corrupt");
    expect(mapPdfError(namedError("MissingPDFException")).code).toBe("corrupt");
    expect(mapPdfError(namedError("FormatError")).code).toBe("corrupt");
    const unknown = mapPdfError(namedError("SomethingElse"));
    expect(unknown.code).toBe("unexpected");
    expect(unknown.message).not.toContain("library message");
    expect(mapPdfError("not an error").code).toBe("unexpected");
  });

  it("passes controlled errors through unchanged", () => {
    const original = new PdfExtractionError("too_large", "x");
    expect(mapPdfError(original)).toBe(original);
  });
});

describe("extractPdf on the synthetic fixtures", () => {
  it("extracts text per page from a normal PDF", async () => {
    const result = await extractPdf(await fixture("single-column.pdf"));
    expect(result.pageCount).toBe(10);
    expect(result.pages).toHaveLength(10);
    expect(result.pages[0].page).toBe(1);
    expect(result.pages[0].text).toContain("Handbook section 1");
    expect(result.likelyScanned).toBe(false);
  });

  it("flags scanned files, including one with a stamped page number", async () => {
    for (const name of ["scanned.pdf", "scanned-with-footer.pdf"]) {
      const result = await extractPdf(await fixture(name));
      expect(result.likelyScanned, name).toBe(true);
    }
  });

  it("does not flag any text fixture, including the sparse one", async () => {
    for (const name of [
      "single-column.pdf",
      "two-column.pdf",
      "table.pdf",
      "thirty-pages.pdf",
      "sparse-text.pdf",
    ]) {
      const result = await extractPdf(await fixture(name));
      expect(result.likelyScanned, name).toBe(false);
      expect(result.avgCharsPerPage).toBeGreaterThan(
        DEFAULT_MIN_AVG_CHARS_PER_PAGE,
      );
    }
  });

  it.each([
    ["encrypted-user-password.pdf", "encrypted"],
    ["corrupt-truncated.pdf", "corrupt"],
    ["corrupt-garbage.pdf", "corrupt"],
    ["fake-exe.pdf", "not_pdf"],
  ])("%s fails with the controlled code %s", async (name, code) => {
    const failure = await extractPdf(await fixture(name)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PdfExtractionError);
    expect((failure as PdfExtractionError).code).toBe(code);
  });

  it("rejects oversized input and too many pages", async () => {
    const bytes = await fixture("single-column.pdf");
    await expect(extractPdf(bytes, { maxBytes: 100 })).rejects.toMatchObject({
      code: "too_large",
    });
    await expect(extractPdf(bytes, { maxPages: 5 })).rejects.toMatchObject({
      code: "too_many_pages",
    });
  });

  it("does not modify the caller's buffer", async () => {
    const bytes = await fixture("single-column.pdf");
    const before = bytes.byteLength;
    await extractPdf(bytes);
    expect(bytes.byteLength).toBe(before);
  });
});

describe("scoring", () => {
  it("ignores case, whitespace and soft hyphens", () => {
    expect(normalizeForMatch("  Hello\n  WOR­LD ")).toBe("hello world");
  });

  it("scores recall and reading order per page", () => {
    const score = scorePages(
      ["alpha beta gamma", "gamma alpha"],
      [
        { page: 1, fragments: ["alpha", "beta", "missing"] },
        { page: 2, fragments: ["alpha", "gamma"] },
      ],
    );
    expect(score.pages[0]).toMatchObject({
      found: 2,
      expected: 3,
      inOrder: true,
    });
    expect(score.pages[1]).toMatchObject({
      found: 2,
      expected: 2,
      inOrder: false,
    });
    expect(score.allInOrder).toBe(false);
  });

  it("validates the expected-file shape", () => {
    expect(() => parseExpectedFile(null)).toThrow();
    expect(() =>
      parseExpectedFile({ pages: [{ page: 0, fragments: [] }] }),
    ).toThrow();
    expect(
      parseExpectedFile({ pages: [{ page: 1, fragments: ["a"] }] }).pages,
    ).toHaveLength(1);
  });
});

describe("route protocol helpers", () => {
  it("validates the text query parameter", () => {
    expect(parseTextMode(null)).toBe("none");
    expect(parseTextMode("full")).toBe("full");
    expect(parseTextMode("everything")).toBeNull();
  });

  it("only includes full text when asked", () => {
    const pages = [{ page: 1, chars: 3, text: "a b c" }];
    expect(toPageReports(pages, "none")[0]).not.toHaveProperty("text");
    expect(toPageReports(pages, "full")[0].text).toBe("a b c");
  });
});

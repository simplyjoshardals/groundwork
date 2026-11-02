import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as unpdf from "unpdf";
import {
  CorruptPdfError,
  EmptyDocumentError,
  EncryptedPdfError,
  ExtractionError,
  FileTooLargeError,
  InvalidFileSignatureError,
  MAX_FILE_BYTES,
  MAX_PAGES,
  ScannedPdfError,
  TooManyPagesError,
  UnexpectedExtractionError,
  UnsupportedMimeTypeError,
  extractPages,
} from "@/lib/pdf";
import { buildPdf, denseText } from "./helpers/pdf-builder";

vi.mock("server-only", () => ({}));

// Pass-through spies so the cleanup tests can observe the real PDF.js objects.
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    getDocumentProxy: vi.fn(actual.getDocumentProxy),
    extractText: vi.fn(actual.extractText),
  };
});

const PDF = "application/pdf";
const encoder = new TextEncoder();

function fixture(name: string): Uint8Array {
  const url = new URL(`./../fixtures/pdf/${name}.pdf`, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

/** N paragraphs of ~3,000 characters: each becomes exactly one virtual page. */
function paragraphs(count: number): string {
  const paragraph = "word ".repeat(600).trim();
  return Array.from({ length: count }, () => paragraph).join("\n\n");
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("extractPages: PDF", () => {
  it("returns one 1-based entry per physical page with separate text", async () => {
    const pages = await extractPages(fixture("single-column"), PDF);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    pages.forEach((p) =>
      expect(p.text).toContain(`Handbook section ${p.page}`),
    );
    expect(pages[0].text).not.toContain("Handbook section 2");
    expect(new Set(pages.map((p) => p.text)).size).toBe(pages.length);
  });

  it("keeps page boundaries for a multi-column layout", async () => {
    const pages = await extractPages(fixture("two-column"), PDF);
    expect(pages.map((p) => p.page)).toEqual(
      Array.from({ length: pages.length }, (_, i) => i + 1),
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(pages.map((p) => p.text)).size).toBe(pages.length);
  });

  it("keeps blank pages so numbering still matches the physical PDF", async () => {
    const pdf = buildPdf([denseText("first"), "", denseText("third")]);
    const pages = await extractPages(pdf, PDF);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[1].text.trim()).toBe("");
    expect(pages[2].text).toContain("third");
  });

  it("accepts the sparse real-text fixture (above the scanned threshold)", async () => {
    const pages = await extractPages(fixture("sparse-text"), PDF);
    expect(pages.length).toBeGreaterThan(0);
  });

  it("accepts a PDF that only has an owner password", async () => {
    const pages = await extractPages(fixture("encrypted-owner-only"), PDF);
    expect(pages).toHaveLength(10);
  });

  it("rejects a PDF that needs a password with a typed error", async () => {
    const error = await failureOf(
      extractPages(fixture("encrypted-user-password"), PDF),
    );
    expect(error).toBeInstanceOf(EncryptedPdfError);
    expect((error as ExtractionError).code).toBe("encrypted_file");
  });

  it("does not modify or detach the caller's buffer", async () => {
    const input = fixture("single-column");
    const before = Uint8Array.from(input);
    await extractPages(input, PDF);
    expect(input.byteLength).toBe(before.byteLength);
    expect(Buffer.from(input).equals(Buffer.from(before))).toBe(true);
  });

  it("accepts a Node Buffer", async () => {
    const pages = await extractPages(
      Buffer.from(fixture("single-column")),
      PDF,
    );
    expect(pages).toHaveLength(10);
  });
});

describe("extractPages: scanned PDFs", () => {
  it.each(["scanned", "scanned-with-footer"])(
    "throws ScannedPdfError for %s",
    async (name) => {
      const error = await failureOf(extractPages(fixture(name), PDF));
      expect(error).toBeInstanceOf(ScannedPdfError);
      expect((error as ExtractionError).code).toBe("scanned_pdf");
    },
  );

  it("treats a PDF with no text at all as scanned", async () => {
    const error = await failureOf(extractPages(buildPdf(["", ""]), PDF));
    expect(error).toBeInstanceOf(ScannedPdfError);
  });
});

describe("extractPages: page limit", () => {
  it("accepts 30 physical pages and rejects 31", async () => {
    const thirty = await extractPages(fixture("thirty-pages"), PDF);
    expect(thirty).toHaveLength(30);

    const build = (n: number) =>
      buildPdf(Array.from({ length: n }, (_, i) => denseText(`p${i + 1}`)));
    expect(await extractPages(build(30), PDF)).toHaveLength(30);

    const error = await failureOf(extractPages(build(31), PDF));
    expect(error).toBeInstanceOf(TooManyPagesError);
    expect((error as ExtractionError).code).toBe("too_many_pages");
  });

  it.each(["text/plain", "text/markdown"])(
    "accepts 30 virtual pages and rejects 31 for %s",
    async (mime) => {
      const ok = await extractPages(encoder.encode(paragraphs(30)), mime);
      expect(ok).toHaveLength(MAX_PAGES);

      const error = await failureOf(
        extractPages(encoder.encode(paragraphs(31)), mime),
      );
      expect(error).toBeInstanceOf(TooManyPagesError);
    },
  );
});

describe("extractPages: invalid and corrupt PDFs", () => {
  it.each(["corrupt-truncated", "corrupt-garbage"])(
    "rejects %s with CorruptPdfError and a sanitized message",
    async (name) => {
      const error = await failureOf(extractPages(fixture(name), PDF));
      expect(error).toBeInstanceOf(CorruptPdfError);
      const typed = error as ExtractionError;
      expect(typed.code).toBe("corrupt_file");
      expect(typed.message).toBe("The PDF could not be read.");
      expect(typed.cause).toBeUndefined();
    },
  );

  it("rejects a renamed executable by its magic bytes", async () => {
    const error = await failureOf(extractPages(fixture("fake-exe"), PDF));
    expect(error).toBeInstanceOf(InvalidFileSignatureError);
    expect((error as ExtractionError).code).toBe("unsupported_type");
  });

  it("rejects other non-PDF content labelled application/pdf", async () => {
    const pe = Uint8Array.from([
      0x4d,
      0x5a,
      0x90,
      0x00,
      ...new Array(200).fill(1),
    ]);
    for (const bytes of [pe, encoder.encode("just some text, not a PDF")]) {
      const error = await failureOf(extractPages(bytes, PDF));
      expect(error).toBeInstanceOf(InvalidFileSignatureError);
    }
  });

  it("does not look for the signature beyond the first 1024 bytes", async () => {
    const late = new Uint8Array(2000).fill(0x20);
    late.set(encoder.encode("%PDF-1.4"), 1500);
    const error = await failureOf(extractPages(late, PDF));
    expect(error).toBeInstanceOf(InvalidFileSignatureError);
  });
});

describe("extractPages: plain text and Markdown", () => {
  it("extracts plain text as virtual pages", async () => {
    const pages = await extractPages(
      encoder.encode("First paragraph.\n\nSecond paragraph."),
      "text/plain",
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain("First paragraph.");
    expect(pages[0].text).toContain("Second paragraph.");
  });

  it("numbers virtual pages from 1 and loses no paragraph", async () => {
    const pages = await extractPages(
      encoder.encode(paragraphs(5)),
      "text/plain",
    );
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps raw Markdown syntax and does not convert it to HTML", async () => {
    const markdown =
      "# Title\n\n- item one\n- item two\n\n**bold** and [a link](https://example.com)\n\n```ts\nconst x = 1;\n```";
    const pages = await extractPages(encoder.encode(markdown), "text/markdown");
    const text = pages.map((p) => p.text).join("\n");
    for (const fragment of [
      "# Title",
      "- item one",
      "**bold**",
      "[a link](https://example.com)",
      "```ts",
      "const x = 1;",
    ]) {
      expect(text).toContain(fragment);
    }
    expect(text).not.toMatch(/<(h1|ul|li|strong|a|code)\b/);
  });

  it("decodes UTF-8 (with a BOM) correctly", async () => {
    const bytes = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode("Café – naïve"),
    ]);
    const pages = await extractPages(bytes, "text/plain");
    expect(pages[0].text).toBe("Café – naïve");
  });

  it("rejects text containing NUL bytes (binary or UTF-16)", async () => {
    const bytes = Uint8Array.from([0x68, 0x00, 0x69, 0x00]);
    const error = await failureOf(extractPages(bytes, "text/plain"));
    expect(error).toBeInstanceOf(InvalidFileSignatureError);
  });

  it("rejects bytes that are not valid UTF-8 instead of replacing them", async () => {
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // Latin-1 "café"
    const error = await failureOf(extractPages(bytes, "text/markdown"));
    expect(error).toBeInstanceOf(InvalidFileSignatureError);
  });

  it("rejects text that is only whitespace", async () => {
    const error = await failureOf(
      extractPages(encoder.encode(" \n\t \r\n"), "text/plain"),
    );
    expect(error).toBeInstanceOf(EmptyDocumentError);
    expect((error as ExtractionError).code).toBe("empty_document");
  });
});

describe("extractPages: input validation", () => {
  it("rejects zero bytes for every supported type", async () => {
    for (const mime of [PDF, "text/plain", "text/markdown"]) {
      const error = await failureOf(extractPages(new Uint8Array(0), mime));
      expect(error).toBeInstanceOf(EmptyDocumentError);
    }
  });

  it.each([
    "application/octet-stream",
    "application/x-msdownload",
    "image/png",
    "text/html",
    "application/json",
    "",
    "pdf",
  ])("rejects the unsupported MIME type %j", async (mime) => {
    const error = await failureOf(extractPages(encoder.encode("hello"), mime));
    expect(error).toBeInstanceOf(UnsupportedMimeTypeError);
    expect((error as ExtractionError).code).toBe("unsupported_type");
  });

  it("ignores MIME case and parameters", async () => {
    const pages = await extractPages(
      encoder.encode("hello"),
      "Text/Plain; charset=utf-8",
    );
    expect(pages).toHaveLength(1);
  });

  it("rejects files over the size limit before reading them", async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61);
    for (const mime of [PDF, "text/plain"]) {
      const error = await failureOf(extractPages(huge, mime));
      expect(error).toBeInstanceOf(FileTooLargeError);
      expect((error as ExtractionError).code).toBe("file_too_large");
    }
  });

  it("throws TypeError for wrong argument types", async () => {
    await expect(
      extractPages("text" as unknown as Uint8Array, "text/plain"),
    ).rejects.toThrow(TypeError);
    await expect(
      extractPages(null as unknown as Uint8Array, "text/plain"),
    ).rejects.toThrow(TypeError);
    await expect(
      extractPages(encoder.encode("x"), undefined as unknown as string),
    ).rejects.toThrow(TypeError);
  });
});

describe("extractPages: PDF resource cleanup", () => {
  const getDocumentProxy = vi.mocked(unpdf.getDocumentProxy);
  const extractText = vi.mocked(unpdf.extractText);
  type Proxy = Awaited<ReturnType<typeof unpdf.getDocumentProxy>>;

  let destroy: ReturnType<typeof vi.spyOn> | null;

  /** Makes the next load record (and optionally break) loadingTask.destroy. */
  async function watchNextLoad(behaviour?: "reject" | "throw"): Promise<void> {
    const actual = await vi.importActual<typeof import("unpdf")>("unpdf");
    destroy = null;
    getDocumentProxy.mockImplementationOnce(async (...args) => {
      const proxy: Proxy = await actual.getDocumentProxy(...args);
      const original = proxy.loadingTask.destroy.bind(proxy.loadingTask);
      const spy = vi.spyOn(proxy.loadingTask, "destroy");
      if (behaviour === "reject") {
        spy.mockRejectedValue(new Error("destroy failed"));
      } else if (behaviour === "throw") {
        spy.mockImplementation(() => {
          throw new Error("destroy threw");
        });
      } else {
        spy.mockImplementation(original);
      }
      destroy = spy;
      return proxy;
    });
  }

  beforeEach(() => {
    destroy = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("releases the PDF after a successful extraction", async () => {
    await watchNextLoad();
    await extractPages(fixture("single-column"), PDF);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("releases the PDF when the page limit is exceeded", async () => {
    await watchNextLoad();
    const pdf = buildPdf(
      Array.from({ length: 31 }, (_, i) => denseText(`p${i}`)),
    );
    await expect(extractPages(pdf, PDF)).rejects.toBeInstanceOf(
      TooManyPagesError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("releases the PDF when it is rejected as scanned", async () => {
    await watchNextLoad();
    await expect(extractPages(fixture("scanned"), PDF)).rejects.toBeInstanceOf(
      ScannedPdfError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("releases the PDF when text extraction itself fails", async () => {
    await watchNextLoad();
    extractText.mockRejectedValueOnce(new Error("internal parser detail"));
    const error = await failureOf(extractPages(fixture("single-column"), PDF));
    expect(error).toBeInstanceOf(UnexpectedExtractionError);
    expect((error as ExtractionError).code).toBe("internal_error");
    expect((error as ExtractionError).message).not.toContain("parser detail");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not let a failing cleanup replace a successful result", async () => {
    for (const behaviour of ["reject", "throw"] as const) {
      await watchNextLoad(behaviour);
      const pages = await extractPages(fixture("single-column"), PDF);
      expect(pages).toHaveLength(10);
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("does not let a failing cleanup replace the original error", async () => {
    for (const behaviour of ["reject", "throw"] as const) {
      await watchNextLoad(behaviour);
      await expect(
        extractPages(fixture("scanned"), PDF),
      ).rejects.toBeInstanceOf(ScannedPdfError);
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("maps unknown library errors to internal_error without leaking details", async () => {
    getDocumentProxy.mockRejectedValueOnce(new Error("secret library detail"));
    const error = await failureOf(extractPages(fixture("single-column"), PDF));
    expect(error).toBeInstanceOf(UnexpectedExtractionError);
    expect((error as ExtractionError).message).not.toContain("secret");
    expect((error as ExtractionError).cause).toBeUndefined();
  });

  it("maps known PDF.js error names to specific codes", async () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    getDocumentProxy.mockRejectedValueOnce(named("PasswordException"));
    await expect(
      extractPages(fixture("single-column"), PDF),
    ).rejects.toBeInstanceOf(EncryptedPdfError);
    getDocumentProxy.mockRejectedValueOnce(named("FormatError"));
    await expect(
      extractPages(fixture("single-column"), PDF),
    ).rejects.toBeInstanceOf(CorruptPdfError);
  });
});

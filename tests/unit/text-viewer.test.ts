import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { chunkPages } from "@/lib/chunking/chunk-pages";
import { paginateText } from "@/lib/chunking/paginate-text";
import { selectFallbackPassage } from "@/lib/pdf-highlight/fallback";
import type { SignedUrlClient } from "@/lib/storage/documents";
import {
  MAX_TEXT_FILE_BYTES,
  loadTextFile,
} from "@/lib/text-viewer/load-text-file";
import {
  describeTextFileFailure,
  isRetryableTextFailure,
} from "@/lib/text-viewer/messages";
import {
  buildTextPages,
  clampPage,
  decodeTextFile,
  isTextMimeType,
  planTextHighlight,
  toHighlightStatus,
  type TextPassage,
} from "@/lib/text-viewer/pages";

const FAQ = readFileSync(
  path.join(process.cwd(), "supabase/seed/kestrel-vane-faq.md"),
  "utf8",
);

/** Mirrors ingestion: extractPages (text) then chunkPages with the defaults. */
function ingest(text: string) {
  return chunkPages(paginateText(text));
}

function passageOf(chunk: ReturnType<typeof ingest>[number]): TextPassage {
  return {
    id: String(chunk.chunkIndex + 1),
    pageNumber: chunk.pageNumber,
    text: chunk.content,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
  };
}

describe("isTextMimeType", () => {
  it("accepts the two text types, ignoring case and parameters", () => {
    expect(isTextMimeType("text/plain")).toBe(true);
    expect(isTextMimeType("text/markdown")).toBe(true);
    expect(isTextMimeType("Text/Markdown; charset=utf-8")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isTextMimeType("application/pdf")).toBe(false);
    expect(isTextMimeType("text/html")).toBe(false);
    expect(isTextMimeType("")).toBe(false);
  });
});

describe("decodeTextFile", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("decodes UTF-8", () => {
    expect(decodeTextFile(encode("héllo ✓"))).toEqual({
      ok: true,
      text: "héllo ✓",
    });
  });
  it("strips a BOM, like the extraction module", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode("abc")]);
    expect(decodeTextFile(bytes)).toEqual({ ok: true, text: "abc" });
  });
  it("rejects invalid UTF-8 instead of replacing bytes", () => {
    expect(decodeTextFile(new Uint8Array([0x61, 0xff, 0x62]))).toEqual({
      ok: false,
      reason: "invalid_text",
    });
  });
  it("rejects NUL bytes (this also rejects UTF-16)", () => {
    const utf16 = new Uint8Array([0x61, 0x00, 0x62, 0x00]);
    expect(decodeTextFile(utf16)).toEqual({
      ok: false,
      reason: "invalid_text",
    });
  });
});

describe("offsets match what ingestion stored", () => {
  it("highlights exactly the chunk content for every chunk of the real Markdown sample", () => {
    const pages = buildTextPages(FAQ);
    const chunks = ingest(FAQ);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const plan = planTextHighlight(pages, chunk.pageNumber, passageOf(chunk));
      expect(plan.status).toBe("highlight");
      if (plan.status === "highlight") {
        expect(plan.match).toBe(chunk.content);
        expect(plan.before + plan.match + plan.after).toBe(
          pages[chunk.pageNumber - 1],
        );
      }
    }
  });

  it("holds across several virtual pages, CRLF, ligatures and astral characters", () => {
    const paragraph =
      "The ﬁnal policy\u00a0text uses CRLF line endings 😀 and keeps going. ";
    const text = Array.from(
      { length: 120 },
      (_, i) => `Section ${i + 1}. ${paragraph.repeat(3)}`,
    ).join("\r\n\r\n");
    const pages = buildTextPages(text);
    expect(pages.length).toBeGreaterThan(2);
    for (const chunk of ingest(text)) {
      const plan = planTextHighlight(pages, chunk.pageNumber, passageOf(chunk));
      expect(plan.status).toBe("highlight");
    }
  });

  it("returns no pages for a file with no text", () => {
    expect(buildTextPages("")).toEqual([]);
    expect(buildTextPages("  \n\n ")).toEqual([]);
  });
});

describe("planTextHighlight", () => {
  const pages = ["Hello brave new world.", "Second page text here."];
  const base: TextPassage = {
    id: "7",
    pageNumber: 1,
    text: "brave new",
    charStart: 6,
    charEnd: 15,
  };

  it("splits the page around the exact range", () => {
    expect(planTextHighlight(pages, 1, base)).toEqual({
      status: "highlight",
      before: "Hello ",
      match: "brave new",
      after: " world.",
    });
  });

  it("does nothing without a passage", () => {
    expect(planTextHighlight(pages, 1, null)).toEqual({ status: "none" });
  });

  it("names the cited page when another page is shown", () => {
    expect(planTextHighlight(pages, 2, base)).toEqual({
      status: "declined",
      reason: "other_page",
      pageNumber: 1,
    });
  });

  it("declines when the text at the offsets is not the stored content", () => {
    const edited = { ...base, text: "brave new!" };
    expect(planTextHighlight(pages, 1, edited)).toMatchObject({
      status: "declined",
      reason: "render_mismatch",
    });
    // Right text, shifted offsets.
    expect(
      planTextHighlight(pages, 1, { ...base, charStart: 5, charEnd: 14 }),
    ).toMatchObject({ status: "declined", reason: "render_mismatch" });
  });

  it("declines bad offsets instead of throwing or guessing", () => {
    for (const offsets of [
      { charStart: -1, charEnd: 5 },
      { charStart: 5, charEnd: 5 },
      { charStart: 9, charEnd: 3 },
      { charStart: 6, charEnd: 999 },
      { charStart: 1.5, charEnd: 9 },
      { charStart: Number.NaN, charEnd: 9 },
    ]) {
      expect(
        planTextHighlight(pages, 1, { ...base, ...offsets }),
      ).toMatchObject({ status: "declined", reason: "render_mismatch" });
    }
  });

  it("declines when the cited page does not exist in the file", () => {
    expect(
      planTextHighlight(pages, 3, { ...base, pageNumber: 3 }),
    ).toMatchObject({ status: "declined", reason: "render_mismatch" });
    expect(planTextHighlight([], 1, base)).toMatchObject({
      status: "declined",
      reason: "render_mismatch",
    });
  });

  it("keeps markup in the text as literal characters (nothing is interpreted)", () => {
    const html = ["Intro <script>alert(1)</script> **bold** end."];
    const plan = planTextHighlight(html, 1, {
      id: "1",
      pageNumber: 1,
      text: "<script>alert(1)</script>",
      charStart: 6,
      charEnd: 31,
    });
    expect(plan).toEqual({
      status: "highlight",
      before: "Intro ",
      match: "<script>alert(1)</script>",
      after: " **bold** end.",
    });
  });
});

describe("toHighlightStatus", () => {
  it("maps every plan to the status the panel already understands", () => {
    expect(toHighlightStatus({ status: "none" })).toEqual({ state: "none" });
    expect(
      toHighlightStatus({
        status: "highlight",
        before: "",
        match: "a",
        after: "",
      }),
    ).toEqual({ state: "highlighted" });
    expect(
      toHighlightStatus({
        status: "declined",
        reason: "other_page",
        pageNumber: 4,
      }),
    ).toEqual({ state: "declined", reason: "other_page", pageNumber: 4 });
  });

  it("a mismatch triggers the Task 3.6 fallback panel; another page does not", () => {
    const passage = { pageNumber: 1, text: "brave new" };
    const mismatch = toHighlightStatus({
      status: "declined",
      reason: "render_mismatch",
      pageNumber: null,
    });
    expect(selectFallbackPassage(mismatch, passage)).toEqual(passage);
    const other = toHighlightStatus({
      status: "declined",
      reason: "other_page",
      pageNumber: 1,
    });
    expect(selectFallbackPassage(other, passage)).toBeNull();
  });
});

describe("clampPage", () => {
  it("keeps the page inside the file", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage(99, 3)).toBe(3);
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(Number.NaN, 3)).toBe(1);
  });
});

describe("loadTextFile", () => {
  const PATH = "samples/kestrel-vane-faq.md";

  function client(
    reply:
      { signedUrl: string } | { error: { message: string; status?: number } },
  ) {
    const createSignedUrl = vi.fn(async () =>
      "signedUrl" in reply
        ? { data: reply, error: null }
        : { data: null, error: reply.error },
    );
    const typed: SignedUrlClient = {
      storage: { from: () => ({ createSignedUrl }) },
    };
    return { client: typed, createSignedUrl };
  }
  const ok = { signedUrl: "https://storage.example/signed?token=secret" };

  it("downloads and decodes the file", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("# Title\n\nBody"),
    ) as unknown as typeof fetch;
    const result = await loadTextFile(client(ok).client, PATH, { fetchImpl });
    expect(result).toEqual({ ok: true, text: "# Title\n\nBody" });
  });

  it("passes signed-URL failures through and sends no download", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const missing = await loadTextFile(
      client({ error: { message: "Object not found", status: 404 } }).client,
      PATH,
      { fetchImpl },
    );
    expect(missing).toEqual({ ok: false, reason: "not_found" });
    const invalid = await loadTextFile(client(ok).client, "../etc/passwd", {
      fetchImpl,
    });
    expect(invalid).toEqual({ ok: false, reason: "invalid_path" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps download failures without leaking the URL", async () => {
    const notFound = vi.fn(
      async () => new Response("no", { status: 404 }),
    ) as unknown as typeof fetch;
    expect(
      await loadTextFile(client(ok).client, PATH, { fetchImpl: notFound }),
    ).toEqual({ ok: false, reason: "not_found" });

    const serverError = vi.fn(
      async () => new Response("no", { status: 500 }),
    ) as unknown as typeof fetch;
    expect(
      await loadTextFile(client(ok).client, PATH, { fetchImpl: serverError }),
    ).toEqual({ ok: false, reason: "failed" });

    const rejected = vi.fn(async () => {
      throw new TypeError(
        "failed to fetch https://storage.example/signed?token=secret",
      );
    }) as unknown as typeof fetch;
    const result = await loadTextFile(client(ok).client, PATH, {
      fetchImpl: rejected,
    });
    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("refuses an oversized file by header and by actual size", async () => {
    const declared = vi.fn(
      async () =>
        new Response("x", {
          headers: { "content-length": String(MAX_TEXT_FILE_BYTES + 1) },
        }),
    ) as unknown as typeof fetch;
    expect(
      await loadTextFile(client(ok).client, PATH, { fetchImpl: declared }),
    ).toEqual({ ok: false, reason: "too_large" });

    const big = vi.fn(
      async () =>
        new Response(new Uint8Array(MAX_TEXT_FILE_BYTES + 1).fill(97)),
    ) as unknown as typeof fetch;
    expect(
      await loadTextFile(client(ok).client, PATH, { fetchImpl: big }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects a file that is not UTF-8 text", async () => {
    const binary = vi.fn(
      async () => new Response(new Uint8Array([0x61, 0xff, 0x00])),
    ) as unknown as typeof fetch;
    expect(
      await loadTextFile(client(ok).client, PATH, { fetchImpl: binary }),
    ).toEqual({ ok: false, reason: "invalid_text" });
  });
});

describe("text file failure messages", () => {
  it("has fixed text for every reason, and only a transient failure retries", () => {
    for (const reason of [
      "invalid_path",
      "not_found",
      "failed",
      "too_large",
      "invalid_text",
    ] as const) {
      expect(describeTextFileFailure(reason).length).toBeGreaterThan(10);
      expect(isRetryableTextFailure(reason)).toBe(reason === "failed");
    }
  });
});

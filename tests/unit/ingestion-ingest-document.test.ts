import { describe, expect, it, vi } from "vitest";
import {
  ClaimLostError,
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_RETRY_WAITS_MS,
  ingestDocument,
  type IngestChunkRow,
  type IngestFailureReason,
  type IngestStore,
} from "@/features/ingestion";
import { PIPELINE_VERSION, chunkPages } from "@/lib/chunking";
import { extractPages } from "@/lib/pdf";
import {
  BadRequestError,
  ProviderUnavailableError,
  RateLimitError,
  type EmbeddingProvider,
} from "@/lib/providers";

vi.mock("server-only", () => ({}));

const DOC_ID = "5a000000-0000-4000-8000-000000000099";
const MODEL = "test-embedding-model";
const DIMENSIONS = 4;
const encoder = new TextEncoder();

/** ~7,000 characters of paragraphs: two virtual pages and several chunks. */
const SAMPLE_TEXT = Array.from(
  { length: 60 },
  (_, i) =>
    `Paragraph ${i + 1}. Kestrel and Vane employees receive leave under policy ${i + 1}, ` +
    `with details recorded in the handbook.`,
).join("\n\n");

interface FakeStoreOptions {
  document?: { mimeType: string; storagePath: string } | null;
  claim?: boolean;
  bytes?: Uint8Array;
  finalizeError?: Error;
  failError?: Error;
}

function createFakeStore(options: FakeStoreOptions = {}) {
  const calls: string[] = [];
  const rows = new Map<number, IngestChunkRow>();
  const failures: IngestFailureReason[] = [];
  const finalized: {
    pageCount: number;
    embeddingModel: string;
    pipelineVersion: number;
  }[] = [];
  const document =
    options.document === undefined
      ? { mimeType: "text/markdown", storagePath: "samples/test.md" }
      : options.document;

  const store: IngestStore = {
    async getDocument(documentId) {
      calls.push("getDocument");
      return document === null ? null : { id: documentId, ...document };
    },
    async claim() {
      calls.push("claim");
      return options.claim ?? true;
    },
    async download() {
      calls.push("download");
      return options.bytes ?? encoder.encode(SAMPLE_TEXT);
    },
    async insertChunks(_documentId, batch) {
      calls.push("insertChunks");
      for (const row of batch) rows.set(row.chunkIndex, row);
    },
    async finalize(_documentId, input) {
      calls.push("finalize");
      if (options.finalizeError) throw options.finalizeError;
      finalized.push(input);
    },
    async fail(_documentId, reason) {
      calls.push("fail");
      if (options.failError) throw options.failError;
      failures.push(reason);
    },
  };
  return { store, calls, rows, failures, finalized };
}

/** Returns a deterministic vector per text; `onCall` can throw to simulate failures. */
function createFakeEmbedder(onCall?: (call: number) => void) {
  const batches: string[][] = [];
  const roles: string[] = [];
  let call = 0;
  const embedder: EmbeddingProvider = {
    model: MODEL,
    dimensions: DIMENSIONS,
    async embed(texts, role) {
      call++;
      onCall?.(call);
      batches.push([...texts]);
      roles.push(role);
      return texts.map((text) => [text.length, 1, 2, 3]);
    },
  };
  return { embedder, batches, roles };
}

function rateLimit(retryAfterMs: number | null = null): RateLimitError {
  return new RateLimitError("Gemini request failed (HTTP 429)", {
    provider: "gemini",
    status: 429,
    retryAfterMs,
  });
}

async function expectedChunks() {
  return chunkPages(
    await extractPages(encoder.encode(SAMPLE_TEXT), "text/markdown"),
  );
}

function run(
  fake: ReturnType<typeof createFakeStore>,
  embedder: EmbeddingProvider,
  options: Parameters<typeof ingestDocument>[1]["options"] = {},
) {
  const sleeps: number[] = [];
  const result = ingestDocument(DOC_ID, {
    store: fake.store,
    embedder,
    options: {
      batchSize: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...options,
    },
  });
  return { result, sleeps };
}

describe("ingestDocument: happy path", () => {
  it("claims, embeds in paced batches, stores every chunk and finalizes", async () => {
    const fake = createFakeStore();
    const { embedder, batches, roles } = createFakeEmbedder();
    const { result, sleeps } = run(fake, embedder);
    const outcome = await result;

    const expected = await expectedChunks();
    expect(expected.length).toBeGreaterThan(6);
    expect(outcome).toEqual({
      status: "ready",
      pageCount: 2,
      chunkCount: expected.length,
    });

    // Order: claim before anything is downloaded; finalize last; no failure recorded.
    expect(fake.calls[0]).toBe("getDocument");
    expect(fake.calls[1]).toBe("claim");
    expect(fake.calls[2]).toBe("download");
    expect(fake.calls[fake.calls.length - 1]).toBe("finalize");
    expect(fake.calls).not.toContain("fail");

    // Batches of 3 (last one smaller), document role, one pause between batches only.
    expect(batches.every((batch) => batch.length <= 3)).toBe(true);
    expect(batches.flat()).toEqual(expected.map((chunk) => chunk.content));
    expect(new Set(roles)).toEqual(new Set(["document"]));
    expect(sleeps).toEqual(
      Array.from({ length: batches.length - 1 }, () => DEFAULT_BATCH_DELAY_MS),
    );
  });

  it("stores the chunker's offsets unchanged, contiguous indexes and one model", async () => {
    const fake = createFakeStore();
    const { embedder } = createFakeEmbedder();
    await run(fake, embedder).result;

    const expected = await expectedChunks();
    const stored = [...fake.rows.values()].sort(
      (a, b) => a.chunkIndex - b.chunkIndex,
    );
    expect(stored).toHaveLength(expected.length);
    stored.forEach((row, index) => {
      const chunk = expected[index];
      expect(row.chunkIndex).toBe(index);
      expect(row.pageNumber).toBe(chunk.pageNumber);
      expect(row.charStart).toBe(chunk.charStart);
      expect(row.charEnd).toBe(chunk.charEnd);
      expect(row.content).toBe(chunk.content);
      expect(row.embedding).toHaveLength(DIMENSIONS);
      expect(row.embeddingModel).toBe(MODEL);
    });
    expect(new Set(stored.map((row) => row.embeddingModel)).size).toBe(1);
    expect(fake.finalized).toEqual([
      {
        pageCount: 2,
        embeddingModel: MODEL,
        pipelineVersion: PIPELINE_VERSION,
      },
    ]);
  });

  it("does not pause when there is only one batch", async () => {
    const fake = createFakeStore();
    const { embedder } = createFakeEmbedder();
    const { result, sleeps } = run(fake, embedder, { batchSize: 100 });
    expect((await result).status).toBe("ready");
    expect(sleeps).toEqual([]);
  });
});

describe("ingestDocument: rate limits and outages", () => {
  it("retries a 429 mid-run with backoff and completes without duplicates", async () => {
    const fake = createFakeStore();
    // Calls 2 and 3 (the second batch) are rate limited; call 4 succeeds.
    const { embedder } = createFakeEmbedder((call) => {
      if (call === 2 || call === 3) throw rateLimit();
    });
    const { result, sleeps } = run(fake, embedder, { batchDelayMs: 1 });
    const outcome = await result;

    const expected = await expectedChunks();
    expect(outcome).toMatchObject({
      status: "ready",
      chunkCount: expected.length,
    });
    // One batch pause (1 ms), then the two retry waits for that batch, in order.
    expect(sleeps.slice(0, 3)).toEqual([1, ...DEFAULT_RETRY_WAITS_MS]);
    expect(fake.rows.size).toBe(expected.length);
    expect(fake.calls).not.toContain("fail");
  });

  it("honours a longer retry hint, up to the cap", async () => {
    const fake = createFakeStore();
    const { embedder } = createFakeEmbedder((call) => {
      if (call === 1) throw rateLimit(40_000);
    });
    const { result, sleeps } = run(fake, embedder);
    expect((await result).status).toBe("ready");
    expect(sleeps[0]).toBe(40_000);
  });

  it("gives up at once when the provider asks for more than the cap", async () => {
    const fake = createFakeStore();
    const { embedder } = createFakeEmbedder(() => {
      throw rateLimit(3_600_000);
    });
    const { result, sleeps } = run(fake, embedder);
    const outcome = await result;
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "provider_unavailable",
    });
    expect(sleeps).toEqual([]);
    expect(fake.failures).toEqual(["provider_unavailable"]);
  });

  it("fails as provider_unavailable after the retries are used up", async () => {
    const fake = createFakeStore();
    let attempts = 0;
    const { embedder } = createFakeEmbedder(() => {
      attempts++;
      throw new ProviderUnavailableError("Gemini request failed (HTTP 503)", {
        provider: "gemini",
        status: 503,
      });
    });
    const { result, sleeps } = run(fake, embedder);
    const outcome = await result;

    expect(attempts).toBe(DEFAULT_RETRY_WAITS_MS.length + 1);
    expect(sleeps).toEqual([...DEFAULT_RETRY_WAITS_MS]);
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "provider_unavailable",
    });
    expect(fake.failures).toEqual(["provider_unavailable"]);
    expect(fake.calls).not.toContain("finalize");
  });

  it("does not retry a bad request and records internal_error", async () => {
    const fake = createFakeStore();
    let attempts = 0;
    const { embedder } = createFakeEmbedder(() => {
      attempts++;
      throw new BadRequestError("Gemini request failed (HTTP 400)", {
        provider: "gemini",
        status: 400,
      });
    });
    const { result, sleeps } = run(fake, embedder);
    expect(await result).toMatchObject({
      status: "failed",
      reason: "internal_error",
    });
    expect(attempts).toBe(1);
    expect(sleeps).toEqual([]);
    expect(fake.failures).toEqual(["internal_error"]);
  });
});

describe("ingestDocument: failures and ownership", () => {
  it("records the extraction error code for a bad file", async () => {
    const fake = createFakeStore({
      document: { mimeType: "application/pdf", storagePath: "samples/x.pdf" },
      bytes: encoder.encode("MZ this is not a pdf"),
    });
    const { embedder, batches } = createFakeEmbedder();
    const outcome = await run(fake, embedder).result;
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "unsupported_type",
    });
    expect(batches).toHaveLength(0);
    expect(fake.failures).toEqual(["unsupported_type"]);
  });

  it("records empty_document for a whitespace-only text file", async () => {
    const fake = createFakeStore({ bytes: encoder.encode("  \n\n \t ") });
    const { embedder } = createFakeEmbedder();
    const outcome = await run(fake, embedder).result;
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "empty_document",
    });
    expect(fake.failures).toEqual(["empty_document"]);
  });

  it("rejects a malformed vector response before writing anything", async () => {
    const fake = createFakeStore();
    const embedder: EmbeddingProvider = {
      model: MODEL,
      dimensions: DIMENSIONS,
      async embed(texts) {
        return texts.map(() => [1, 2]);
      },
    };
    const outcome = await run(fake, embedder).result;
    expect(outcome).toMatchObject({
      status: "failed",
      reason: "internal_error",
    });
    expect(fake.rows.size).toBe(0);
  });

  it("returns not_found without claiming", async () => {
    const fake = createFakeStore({ document: null });
    const { embedder } = createFakeEmbedder();
    expect(await run(fake, embedder).result).toEqual({ status: "not_found" });
    expect(fake.calls).toEqual(["getDocument"]);
  });

  it("returns not_claimed without downloading when the claim is refused", async () => {
    const fake = createFakeStore({ claim: false });
    const { embedder } = createFakeEmbedder();
    expect(await run(fake, embedder).result).toEqual({ status: "not_claimed" });
    expect(fake.calls).toEqual(["getDocument", "claim"]);
  });

  it("does not call fail when the claim was lost before finalize", async () => {
    const fake = createFakeStore({ finalizeError: new ClaimLostError() });
    const { embedder } = createFakeEmbedder();
    expect(await run(fake, embedder).result).toEqual({ status: "claim_lost" });
    expect(fake.calls).not.toContain("fail");
  });

  it("rejects when the failure itself cannot be recorded", async () => {
    const fake = createFakeStore({
      bytes: encoder.encode("  "),
      failError: new Error("database down"),
    });
    const { embedder } = createFakeEmbedder();
    await expect(run(fake, embedder).result).rejects.toThrow(
      "could not be recorded",
    );
  });
});

describe("ingestDocument: argument validation", () => {
  it("rejects a document id that is not a UUID, before touching the store", async () => {
    const fake = createFakeStore();
    const { embedder } = createFakeEmbedder();
    await expect(
      ingestDocument("not-a-uuid", { store: fake.store, embedder }),
    ).rejects.toThrow(TypeError);
    expect(fake.calls).toEqual([]);
  });

  it.each([
    { batchSize: 0 },
    { batchSize: 101 },
    { batchSize: 1.5 },
    { batchDelayMs: -1 },
    { maxRetryWaitMs: Number.NaN },
    { retryWaitsMs: [-5] },
  ])("rejects invalid options %o", async (options) => {
    const fake = createFakeStore();
    const { embedder } = createFakeEmbedder();
    await expect(
      ingestDocument(DOC_ID, { store: fake.store, embedder, options }),
    ).rejects.toThrow(RangeError);
    expect(fake.calls).toEqual([]);
  });
});

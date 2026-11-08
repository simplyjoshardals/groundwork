import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestIngest } from "@/lib/upload/request-ingest";

const ID = "123e4567-e89b-42d3-a456-426614174000";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("requestIngest", () => {
  it("posts the document id as JSON to /api/ingest", async () => {
    const fetchImpl = reply(200, { status: "no_op" });
    await requestIngest(ID, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: ID }),
    });
  });

  it("returns ready with the counts", async () => {
    const result = await requestIngest(
      ID,
      reply(200, { status: "ready", pageCount: 3, chunkCount: 7 }),
    );
    expect(result).toEqual({ status: "ready", pageCount: 3, chunkCount: 7 });
  });

  it("returns a failed reason, and maps an unknown code to internal_error", async () => {
    expect(
      await requestIngest(ID, reply(200, { status: "failed", reason: "scanned_pdf" })),
    ).toEqual({ status: "failed", reason: "scanned_pdf" });
    expect(
      await requestIngest(ID, reply(200, { status: "failed", reason: "weird" })),
    ).toEqual({ status: "failed", reason: "internal_error" });
  });

  it("never passes server text or extra fields from a failed body to the caller", async () => {
    const result = await requestIngest(
      ID,
      reply(200, {
        status: "failed",
        reason: "corrupt_file",
        message: "secret provider text",
        stack: "at /srv/app/route.ts:1",
      }),
    );
    expect(result).toEqual({ status: "failed", reason: "corrupt_file" });
    expect(JSON.stringify(result)).not.toMatch(/secret|route\.ts/);
  });

  it("treats a prototype key as an unknown reason", async () => {
    expect(
      await requestIngest(ID, reply(200, { status: "failed", reason: "toString" })),
    ).toEqual({ status: "failed", reason: "internal_error" });
  });

  it("returns no_op", async () => {
    expect(await requestIngest(ID, reply(200, { status: "no_op" }))).toEqual({
      status: "no_op",
    });
  });

  it.each([401, 404, 500, 504])("returns unconfirmed for HTTP %i", async (code) => {
    const result = await requestIngest(ID, reply(code, { error: "x" }));
    expect(result).toEqual({ status: "unconfirmed" });
    expect(console.warn).toHaveBeenCalled();
  });

  it.each([
    ["an unknown status", { status: "weird" }],
    ["ready without counts", { status: "ready" }],
    ["ready with a negative count", { status: "ready", pageCount: -1, chunkCount: 1 }],
    ["failed without a reason", { status: "failed" }],
    ["null", null],
  ])("returns unconfirmed for a 200 with %s", async (_name, body) => {
    expect(await requestIngest(ID, reply(200, body))).toEqual({
      status: "unconfirmed",
    });
  });

  it("returns unconfirmed when the body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await requestIngest(ID, fetchImpl)).toEqual({ status: "unconfirmed" });
  });

  it("returns unconfirmed when the network fails, without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestIngest(ID, fetchImpl)).toEqual({ status: "unconfirmed" });
  });
});

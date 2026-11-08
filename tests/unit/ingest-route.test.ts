import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getClaims, ingestOwnedDocument } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  ingestOwnedDocument: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getClaims } })),
}));
vi.mock("@/features/ingestion", () => ({ ingestOwnedDocument }));

import * as route from "@/app/api/ingest/route";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

const post = (body: unknown, raw = false) =>
  route.POST(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  ingestOwnedDocument.mockResolvedValue({
    status: "ready",
    pageCount: 4,
    chunkCount: 9,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("route config", () => {
  it("exports only POST and the approved segment config", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(300);
    expect(
      Object.keys(route).filter((k) => /^(GET|PUT|PATCH|DELETE)$/.test(k)),
    ).toEqual([]);
  });

  it("does not import the admin Supabase client", () => {
    const source = readFileSync("app/api/ingest/route.ts", "utf8");
    expect(source).not.toMatch(/supabase\/admin|createAdminSupabase/);
  });
});

describe("POST /api/ingest: request validation", () => {
  it("returns 400 for invalid JSON, before touching auth", async () => {
    const response = await post("{not json", true);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it.each([
    ["an array", []],
    ["no documentId", {}],
    ["a non-string id", { documentId: 5 }],
    ["a non-UUID id", { documentId: "../etc/passwd" }],
  ])("returns 400 for %s, before touching auth", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(getClaims).not.toHaveBeenCalled();
    expect(ingestOwnedDocument).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest: authentication", () => {
  it.each([
    ["error", { data: null, error: { message: "no session" } }],
    ["no claims", { data: { claims: null }, error: null }],
    ["no sub", { data: { claims: {} }, error: null }],
  ])("returns 401 on %s and does no work", async (_name, result) => {
    getClaims.mockResolvedValue(result);
    const response = await post({ documentId: UUID });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(ingestOwnedDocument).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest: outcomes", () => {
  it("passes the user and the normalized id on, and returns ready", async () => {
    const response = await post({ documentId: UUID.toUpperCase() });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      pageCount: 4,
      chunkCount: 9,
    });
    expect(ingestOwnedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", documentId: UUID }),
    );
  });

  it.each(["not_claimed", "claim_lost"])(
    "maps %s to a 200 no-op",
    async (status) => {
      ingestOwnedDocument.mockResolvedValue({ status });
      const response = await post({ documentId: UUID });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "no_op" });
    },
  );

  it("returns 404 with no detail for a document that is not the caller's", async () => {
    ingestOwnedDocument.mockResolvedValue({ status: "not_found" });
    const response = await post({ documentId: UUID });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("returns only the reason code for a failed ingestion, never the error", async () => {
    ingestOwnedDocument.mockResolvedValue({
      status: "failed",
      reason: "scanned_pdf",
      error: new Error("secret provider text at /srv/app/stack.ts:1"),
    });
    const response = await post({ documentId: UUID });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      status: "failed",
      reason: "scanned_pdf",
    });
    expect(text).not.toMatch(/secret|stack/);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns a generic 500 when something throws", async () => {
    ingestOwnedDocument.mockRejectedValue(new Error("db password is hunter2"));
    const response = await post({ documentId: UUID });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: "internal_error" });
    expect(text).not.toMatch(/hunter2/);
  });
});

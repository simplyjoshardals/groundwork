import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getClaims, deleteOwnedDocument } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  deleteOwnedDocument: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({ auth: { getClaims } })),
}));
vi.mock("@/features/storage-cleanup", () => ({ deleteOwnedDocument }));

import * as route from "@/app/api/documents/[id]/route";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

const del = (id: string) =>
  route.DELETE(
    new Request(`http://localhost/api/documents/${id}`, { method: "DELETE" }),
    {
      params: Promise.resolve({ id }),
    },
  );

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  deleteOwnedDocument.mockResolvedValue({
    status: "deleted",
    fileRemoved: true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("route config", () => {
  it("exports only DELETE and the segment config", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(
      Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH)$/.test(k)),
    ).toEqual([]);
  });

  it("does not import the admin Supabase client", () => {
    const source = readFileSync("app/api/documents/[id]/route.ts", "utf8");
    expect(source).not.toMatch(/supabase\/admin|createAdminSupabase/);
  });
});

describe("DELETE /api/documents/[id]", () => {
  it("returns 400 for a non-UUID id, before touching auth", async () => {
    const response = await del("../etc/passwd");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(getClaims).not.toHaveBeenCalled();
    expect(deleteOwnedDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["error", { data: null, error: { message: "no session" } }],
    ["no claims", { data: { claims: null }, error: null }],
    ["no sub", { data: { claims: {} }, error: null }],
  ])("returns 401 on %s and deletes nothing", async (_n, result) => {
    getClaims.mockResolvedValue(result);
    const response = await del(UUID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(deleteOwnedDocument).not.toHaveBeenCalled();
  });

  it("passes the user and the normalized id on, and returns 200", async () => {
    const response = await del(UUID.toUpperCase());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "deleted",
      fileRemoved: true,
    });
    expect(deleteOwnedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", documentId: UUID }),
    );
  });

  it("returns 404 with no detail when nothing was deleted", async () => {
    deleteOwnedDocument.mockResolvedValue({ status: "not_found" });
    const response = await del(UUID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("still returns 200 when the file cleanup failed, and logs it", async () => {
    deleteOwnedDocument.mockResolvedValue({
      status: "deleted",
      fileRemoved: false,
      cleanupError: new Error("storage down at /srv/secret.ts"),
    });
    const response = await del(UUID);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "deleted", fileRemoved: false });
    expect(text).not.toMatch(/secret/);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns a generic 500 when the row delete throws", async () => {
    deleteOwnedDocument.mockRejectedValue(new Error("db password is hunter2"));
    const response = await del(UUID);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: "internal_error" });
    expect(text).not.toMatch(/hunter2/);
  });
});

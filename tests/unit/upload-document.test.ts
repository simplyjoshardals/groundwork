import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FILE_BYTES } from "@/lib/pdf/limits";
import { MAX_DOCS_PER_USER_HINT } from "@/lib/upload/file-checks";
import {
  DOCUMENT_LIMIT_MESSAGE,
  UPLOADS_PAUSED_MESSAGE,
  type InsertFailureReason,
} from "@/lib/upload/limits";
import {
  uploadDocument,
  type NewDocumentRow,
  type UploadPorts,
  type UploadSession,
} from "@/lib/upload/upload-document";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_ID = "a1000000-0000-4000-8000-000000000001";

type Overrides = Partial<{
  session: UploadSession;
  count: { ok: true; count: number } | { ok: false };
  insertOk: boolean;
  insertReason: InsertFailureReason;
  uploadOk: boolean;
  deleteOk: boolean;
}>;

function makePorts(overrides: Overrides = {}) {
  const calls: string[] = [];
  const inserted: NewDocumentRow[] = [];
  const uploads: Array<{ path: string; body: Blob; contentType: string }> = [];
  const deleted: string[] = [];
  const ports: UploadPorts = {
    async getSession() {
      calls.push("session");
      return (
        overrides.session ?? {
          status: "signed_in",
          userId: USER,
          isAnonymous: false,
        }
      );
    },
    async countOwnDocuments() {
      calls.push("count");
      return overrides.count ?? { ok: true, count: 0 };
    },
    async insertDocument(row) {
      calls.push("insert");
      inserted.push(row);
      return {
        ok: overrides.insertOk ?? true,
        ...(overrides.insertReason ? { reason: overrides.insertReason } : {}),
      };
    },
    async uploadFile(path, body, contentType) {
      calls.push("upload");
      uploads.push({ path, body, contentType });
      return { ok: overrides.uploadOk ?? true };
    },
    async deleteDocument(id) {
      calls.push("delete");
      deleted.push(id);
      return { ok: overrides.deleteOk ?? true };
    },
    newId: () => DOC_ID,
  };
  return { ports, calls, inserted, uploads, deleted };
}

function pdf(name = "Lease 2026.pdf") {
  return new File(["%PDF-1.7 test"], name, { type: "application/pdf" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uploadDocument", () => {
  it("inserts the queued row, then uploads to the row's exact path", async () => {
    const { ports, calls, inserted, uploads } = makePorts();
    const result = await uploadDocument(pdf(), ports);

    const path = `${USER}/${DOC_ID}/Lease_2026.pdf`;
    expect(result).toEqual({
      ok: true,
      documentId: DOC_ID,
      storagePath: path,
      title: "Lease 2026",
    });
    expect(calls).toEqual(["session", "count", "insert", "upload"]);
    expect(inserted).toEqual([
      {
        id: DOC_ID,
        owner_id: USER,
        title: "Lease 2026",
        original_filename: "Lease 2026.pdf",
        mime_type: "application/pdf",
        size_bytes: 13,
        storage_path: path,
      },
    ]);
    expect(uploads[0]?.path).toBe(path);
  });

  it("sets text/markdown for .md even when the browser reports another type", async () => {
    const { ports, inserted, uploads } = makePorts();
    const file = new File(["# Notes"], "notes.md", {
      type: "application/octet-stream",
    });
    const result = await uploadDocument(file, ports);

    expect(result.ok).toBe(true);
    expect(inserted[0]?.mime_type).toBe("text/markdown");
    expect(uploads[0]?.contentType).toBe("text/markdown");
    expect(uploads[0]?.body.type).toBe("text/markdown");
    expect(await uploads[0]?.body.text()).toBe("# Notes");
  });

  it("makes no request at all for an oversized file", async () => {
    const { ports, calls } = makePorts();
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.pdf");
    const result = await uploadDocument(big, ports);

    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    expect(calls).toEqual([]);
  });

  it("makes no request for an unsupported or empty file", async () => {
    const { ports, calls } = makePorts();
    const exe = await uploadDocument(new File(["MZ"], "setup.exe"), ports);
    const empty = await uploadDocument(new File([], "empty.txt"), ports);

    expect(exe).toMatchObject({ ok: false, reason: "unsupported_type" });
    expect(empty).toMatchObject({ ok: false, reason: "empty" });
    expect(calls).toEqual([]);
  });

  it("refuses a demo session before counting or inserting", async () => {
    const { ports, calls } = makePorts({
      session: { status: "signed_in", userId: USER, isAnonymous: true },
    });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toMatchObject({ ok: false, reason: "demo_session" });
    expect(calls).toEqual(["session"]);
  });

  it("reports a signed-out session and a failed session check differently", async () => {
    const out = await uploadDocument(
      pdf(),
      makePorts({ session: { status: "signed_out" } }).ports,
    );
    const failed = await uploadDocument(
      pdf(),
      makePorts({ session: { status: "failed" } }).ports,
    );

    expect(out).toMatchObject({ ok: false, reason: "signed_out" });
    expect(failed).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("blocks at the document limit and allows one below it", async () => {
    const atLimit = makePorts({
      count: { ok: true, count: MAX_DOCS_PER_USER_HINT },
    });
    const blocked = await uploadDocument(pdf(), atLimit.ports);
    expect(blocked).toMatchObject({ ok: false, reason: "limit_reached" });
    expect(atLimit.calls).toEqual(["session", "count"]);

    const below = makePorts({
      count: { ok: true, count: MAX_DOCS_PER_USER_HINT - 1 },
    });
    expect((await uploadDocument(pdf(), below.ports)).ok).toBe(true);
  });

  it("carries on when only the count check fails (the trigger is the real cap)", async () => {
    const { ports, calls } = makePorts({ count: { ok: false } });
    expect((await uploadDocument(pdf(), ports)).ok).toBe(true);
    expect(calls).toEqual(["session", "count", "insert", "upload"]);
  });

  it("does not upload or delete when the insert fails", async () => {
    const { ports, calls } = makePorts({ insertOk: false });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toMatchObject({ ok: false, reason: "insert_failed" });
    expect(calls).toEqual(["session", "count", "insert"]);
  });

  it("turns the trigger's document cap error into the limit message", async () => {
    const { ports, calls } = makePorts({
      insertOk: false,
      insertReason: "document_limit_reached",
    });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toEqual({
      ok: false,
      reason: "limit_reached",
      message: DOCUMENT_LIMIT_MESSAGE,
    });
    expect(calls).toEqual(["session", "count", "insert"]);
  });

  it("turns the trigger's storage budget error into the uploads-paused message", async () => {
    const { ports, calls } = makePorts({
      insertOk: false,
      insertReason: "storage_budget_exhausted",
    });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toEqual({
      ok: false,
      reason: "budget_exhausted",
      message: UPLOADS_PAUSED_MESSAGE,
    });
    expect(calls).toEqual(["session", "count", "insert"]);
  });

  it("keeps the generic message for an insert refused for another reason", async () => {
    const { ports } = makePorts({ insertOk: false, insertReason: "other" });
    expect(await uploadDocument(pdf(), ports)).toMatchObject({
      ok: false,
      reason: "insert_failed",
    });
  });

  it("removes the queued row when the upload fails", async () => {
    const { ports, calls, deleted } = makePorts({ uploadOk: false });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toMatchObject({ ok: false, reason: "upload_failed" });
    expect(calls).toEqual(["session", "count", "insert", "upload", "delete"]);
    expect(deleted).toEqual([DOC_ID]);
  });

  it("still reports the upload failure, and logs, when the cleanup also fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { ports } = makePorts({ uploadOk: false, deleteOk: false });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toMatchObject({ ok: false, reason: "upload_failed" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stops before the insert if the path would be malformed", async () => {
    const { ports, calls } = makePorts({
      session: { status: "signed_in", userId: "not-a-uuid", isAnonymous: false },
    });
    const result = await uploadDocument(pdf(), ports);

    expect(result).toMatchObject({ ok: false, reason: "internal_error" });
    expect(calls).toEqual(["session", "count"]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  DOCUMENTS_BUCKET,
  MAX_SIGNED_URL_TTL_SECONDS,
  createDocumentSignedUrl,
  isDocumentStoragePath,
  type SignedUrlClient,
} from "@/lib/storage/documents";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC = "a1000000-0000-4000-8000-000000000001";
const OWN_PATH = `${OWNER}/${DOC}/apartment-lease-2026.pdf`;
const SAMPLE_PATH = "samples/kestrel-vane-employee-handbook.pdf";

type Reply = Awaited<
  ReturnType<ReturnType<SignedUrlClient["storage"]["from"]>["createSignedUrl"]>
>;

function fakeClient(reply: Reply | Error) {
  const createSignedUrl = vi.fn(async (): Promise<Reply> => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const from = vi.fn(() => ({ createSignedUrl }));
  const client: SignedUrlClient = { storage: { from } };
  return { client, from, createSignedUrl };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isDocumentStoragePath", () => {
  it("accepts a sample path and an owner/document/file path", () => {
    expect(isDocumentStoragePath(SAMPLE_PATH)).toBe(true);
    expect(isDocumentStoragePath(OWN_PATH)).toBe(true);
  });

  it.each([
    "",
    "samples/",
    "samples/../secret.pdf",
    "samples/..",
    "samples/.",
    "samples/a/b.pdf",
    "other/file.pdf",
    `${OWNER}/${DOC}`,
    `${OWNER}/${DOC}/`,
    `${OWNER}/${DOC}/a/b.pdf`,
    `${OWNER}/../${DOC}/f.pdf`,
    `${OWNER.toUpperCase()}/${DOC}/f.pdf`,
    `/${OWNER}/${DOC}/f.pdf`,
    `${OWNER}/${DOC}/f.pdf?x=1`,
    `${OWNER}/${DOC}/my file.pdf`,
    `samples/${"a".repeat(101)}`,
  ])("rejects %j", (value) => {
    expect(isDocumentStoragePath(value)).toBe(false);
  });
});

describe("createDocumentSignedUrl", () => {
  it("returns the URL and an expiry from the default lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    const { client, from, createSignedUrl } = fakeClient({
      data: { signedUrl: "http://127.0.0.1/signed?token=t" },
      error: null,
    });

    const result = await createDocumentSignedUrl(client, SAMPLE_PATH);

    expect(result).toEqual({
      ok: true,
      url: "http://127.0.0.1/signed?token=t",
      expiresAt: new Date(
        Date.parse("2026-11-07T12:00:00Z") +
          DEFAULT_SIGNED_URL_TTL_SECONDS * 1000,
      ),
    });
    expect(from).toHaveBeenCalledWith(DOCUMENTS_BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith(
      SAMPLE_PATH,
      DEFAULT_SIGNED_URL_TTL_SECONDS,
    );
  });

  it("passes a custom lifetime through", async () => {
    const { client, createSignedUrl } = fakeClient({
      data: { signedUrl: "u" },
      error: null,
    });
    await createDocumentSignedUrl(client, OWN_PATH, { expiresIn: 60 });
    expect(createSignedUrl).toHaveBeenCalledWith(OWN_PATH, 60);
  });

  it("does not call storage for a malformed path", async () => {
    const { client, from } = fakeClient({ data: null, error: null });
    const result = await createDocumentSignedUrl(client, "../etc/passwd");
    expect(result).toMatchObject({ ok: false, reason: "invalid_path" });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    [{ message: "Object not found", status: 400 }],
    [{ message: "whatever", status: 404 }],
    [{ message: "Object not found" }],
  ])("maps %j to not_found", async (error) => {
    const { client } = fakeClient({ data: null, error });
    const result = await createDocumentSignedUrl(client, OWN_PATH);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("maps other storage errors to failed", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "Internal error", status: 500 },
    });
    const result = await createDocumentSignedUrl(client, OWN_PATH);
    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "Internal error",
    });
  });

  it("maps a thrown network error to failed instead of throwing", async () => {
    const { client } = fakeClient(new Error("fetch failed"));
    const result = await createDocumentSignedUrl(client, OWN_PATH);
    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "fetch failed",
    });
  });

  it("treats a response with neither data nor error as failed", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const result = await createDocumentSignedUrl(client, OWN_PATH);
    expect(result).toMatchObject({ ok: false, reason: "failed" });
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_SIGNED_URL_TTL_SECONDS + 1])(
    "throws RangeError for expiresIn %s",
    async (expiresIn) => {
      const { client, from } = fakeClient({ data: null, error: null });
      await expect(
        createDocumentSignedUrl(client, OWN_PATH, { expiresIn }),
      ).rejects.toThrow(RangeError);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("accepts the boundary lifetimes 1 and the maximum", async () => {
    const { client } = fakeClient({ data: { signedUrl: "u" }, error: null });
    for (const expiresIn of [1, MAX_SIGNED_URL_TTL_SECONDS]) {
      const result = await createDocumentSignedUrl(client, OWN_PATH, {
        expiresIn,
      });
      expect(result.ok).toBe(true);
    }
  });
});

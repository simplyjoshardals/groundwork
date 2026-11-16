// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthListener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

let listener: AuthListener | null = null;
const getViewerDocument = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: AuthListener) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  }),
}));
vi.mock("@/lib/documents/get-viewer-document", () => ({
  getViewerDocument: (...args: unknown[]) => getViewerDocument(...args),
}));
vi.mock("@/lib/documents/get-chunk", () => ({ getChunk: vi.fn() }));

const DOC = "11111111-1111-4111-8111-111111111111";
const ok = { ok: true, document: { id: DOC } };

beforeEach(() => {
  vi.resetModules();
  listener = null;
  getViewerDocument.mockReset();
  getViewerDocument.mockResolvedValue(ok);
});
afterEach(() => vi.restoreAllMocks());

async function load() {
  return await import("@/lib/viewer-prefetch");
}

describe("viewer prefetch and the signed-in user", () => {
  it("serves the second lookup from the cache", async () => {
    const { loadViewerDocument } = await load();
    await loadViewerDocument(DOC);
    await loadViewerDocument(DOC);
    expect(getViewerDocument).toHaveBeenCalledTimes(1);
  });

  it("forgets everything on sign-out", async () => {
    const { loadViewerDocument } = await load();
    await loadViewerDocument(DOC);
    listener?.("SIGNED_OUT", null);
    await loadViewerDocument(DOC);
    expect(getViewerDocument).toHaveBeenCalledTimes(2);
  });

  it("forgets everything when a different user signs in", async () => {
    const { loadViewerDocument } = await load();
    await loadViewerDocument(DOC);
    listener?.("INITIAL_SESSION", { user: { id: "a" } });
    listener?.("SIGNED_IN", { user: { id: "b" } });
    await loadViewerDocument(DOC);
    expect(getViewerDocument).toHaveBeenCalledTimes(2);
  });

  it("keeps the cache when the same user's session is refreshed", async () => {
    const { loadViewerDocument } = await load();
    await loadViewerDocument(DOC);
    listener?.("INITIAL_SESSION", { user: { id: "a" } });
    listener?.("SIGNED_IN", { user: { id: "a" } });
    listener?.("TOKEN_REFRESHED", { user: { id: "a" } });
    await loadViewerDocument(DOC);
    expect(getViewerDocument).toHaveBeenCalledTimes(1);
  });
});

import { expect, test, type Page } from "@playwright/test";
import { getChunk } from "@/lib/documents/get-chunk";
import { getViewerDocument } from "@/lib/documents/get-viewer-document";
import { describeSignedUrlFailure } from "@/lib/pdf-viewer/messages";
import { createDocumentSignedUrl } from "@/lib/storage/documents";
import { fixturePath, TEXT_PDF_NAME, titleOf } from "./helpers/fixtures";
import { waitForHydration } from "./helpers/hydration";
import { readOwnUpload, signInAsApi } from "./helpers/supabase-api";
import { createTestUser, signUpViaUi } from "./helpers/test-user";

const INGEST_TIMEOUT_MS = 120_000;
const ANSWER_TIMEOUT_MS = 60_000;

/** Same question as Task 4.9: only `single-column.pdf` mentions Brindlemoor. */
const QUESTION =
  "In the Brindlemoor notes, which group reviews the quarterly parking permit policy?";

/**
 * Headline of the not-found state. It is a private constant in
 * `lib/ask-client/answer-state.ts`, so it is copied here: if the wording
 * changes, this test fails loudly and needs the same edit.
 */
const NOT_FOUND_MESSAGE = "I couldn't find that in the documents.";

async function uploadAndWaitUntilReady(page: Page): Promise<void> {
  const title = titleOf(TEXT_PDF_NAME);
  const fileInput = page.getByLabel("Upload a document");
  await waitForHydration(fileInput);
  await fileInput.setInputFiles(fixturePath(TEXT_PDF_NAME));
  await expect(
    page.getByText(`${TEXT_PDF_NAME} is ready to search.`),
  ).toBeVisible({ timeout: INGEST_TIMEOUT_MS });
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText("Ready", { exact: true })).toBeVisible();
}

test("user B cannot see, open, fetch or ask about user A's document", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("E2E: the project has no baseURL.");

  const title = titleOf(TEXT_PDF_NAME);
  const userA = createTestUser();
  const userB = createTestUser();

  // --- User A signs up and uploads. ---
  await signUpViaUi(page, userA);
  await uploadAndWaitUntilReady(page);

  // A's ids, read as A (no Gemini call). The signed URL is a control: it
  // proves the path is right, so B's refusal below is not a typo in the path.
  const clientA = await signInAsApi(userA);
  const upload = await readOwnUpload(clientA);
  const ownUrl = await createDocumentSignedUrl(clientA, upload.storagePath);
  expect(ownUrl.ok).toBe(true);

  // --- User B, in a separate browser context (separate cookies). ---
  const contextB = await browser.newContext({ baseURL });
  try {
    const pageB = await contextB.newPage();
    await signUpViaUi(pageB, userB);
    const clientB = await signInAsApi(userB);

    // 1. List documents. The UI shows B's empty state, never A's title.
    await expect(pageB.getByText(/No documents yet/)).toBeVisible();
    await expect(pageB.getByText(title)).toHaveCount(0);
    // Through the API: B sees public samples, but never A's row.
    const visible = await clientB.from("documents").select("id, title");
    expect(visible.error).toBeNull();
    expect(visible.data?.map((row) => row.id)).not.toContain(upload.documentId);
    const byId = await clientB
      .from("documents")
      .select("id")
      .eq("id", upload.documentId);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);
    expect(await getViewerDocument(clientB, upload.documentId)).toEqual({
      ok: false,
      reason: "not_found",
    });

    // 2. Open A's document URL (with A's chunk id, as a citation link has).
    await pageB.goto(
      `/?doc=${upload.documentId}&page=1&chunk=${upload.chunkId}`,
    );
    const viewer = pageB.getByRole("complementary", {
      name: "Document viewer",
    });
    await expect(
      viewer.getByText(describeSignedUrlFailure("not_found")),
    ).toBeVisible();
    await expect(pageB.locator("canvas")).toHaveCount(0);
    await expect(pageB.getByText(/Brindlemoor/)).toHaveCount(0);
    // The chunk behind that link is just as hidden.
    expect(await getChunk(clientB, upload.chunkId)).toEqual({
      ok: false,
      reason: "not_found",
    });

    // 3. Request a signed URL for A's file.
    const signed = await createDocumentSignedUrl(clientB, upload.storagePath);
    expect(signed).toMatchObject({ ok: false, reason: "not_found" });

    // 4. Ask a question only A's file can answer.
    await pageB.goto("/");
    await waitForHydration(pageB.getByLabel(/ask a question/i));
    await pageB.getByLabel(/ask a question/i).fill(QUESTION);
    await pageB.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(
      pageB.getByRole("status").filter({ hasText: NOT_FOUND_MESSAGE }),
    ).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });
    // No citation chip, and A's file is not even among the closest passages
    // (they sit in a collapsed <details>, which getByText still sees).
    await expect(
      pageB.getByRole("button", { name: /^Source \d+:/ }),
    ).toHaveCount(0);
    await expect(pageB.getByText(/single-column/i)).toHaveCount(0);
  } finally {
    await contextB.close();
  }
});

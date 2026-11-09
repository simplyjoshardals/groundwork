import { expect, test } from "@playwright/test";
import { INGEST_FAILURE_MESSAGES } from "@/lib/ingest/failure-messages";
import {
  fixturePath,
  SCANNED_PDF_NAME,
  TEXT_PDF_NAME,
  titleOf,
} from "./helpers/fixtures";
import { waitForHydration } from "./helpers/hydration";
import { createTestUser, signUpViaUi } from "./helpers/test-user";

const INGEST_TIMEOUT_MS = 120_000;
const ANSWER_TIMEOUT_MS = 60_000;

/**
 * Every line of `single-column.pdf` starts with "Brindlemoor note", so the
 * name keeps retrieval on the uploaded file and away from the shared samples.
 * The test checks where the answer came from, never what it says.
 */
const QUESTION =
  "In the Brindlemoor notes, which group reviews the quarterly parking permit policy?";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("sign up, upload a PDF, wait for ready, ask, and see a cited source", async ({
  page,
}) => {
  const title = titleOf(TEXT_PDF_NAME);
  await signUpViaUi(page, createTestUser());

  const fileInput = page.getByLabel("Upload a document");
  await waitForHydration(fileInput);
  await fileInput.setInputFiles(fixturePath(TEXT_PDF_NAME));

  await expect(
    page.getByText(`${TEXT_PDF_NAME} is ready to search.`),
  ).toBeVisible({ timeout: INGEST_TIMEOUT_MS });
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText("Ready", { exact: true })).toBeVisible();

  await page.getByLabel(/ask a question/i).fill(QUESTION);
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  // Retrieval returns several passages from the file, so these match many
  // elements; `.first()` checks that at least one is shown.
  const sources = page.getByRole("region", { name: "Sources" });
  await expect(
    sources.getByText(new RegExp(`${escapeRegExp(title)}, p\\. \\d+`)).first(),
  ).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });
  // A citation chip in the answer: its accessible name is "Source n: title, page p".
  await expect(
    page
      .getByRole("button", {
        name: new RegExp(`^Source \\d+: ${escapeRegExp(title)}, page \\d+$`),
      })
      .first(),
  ).toBeVisible({ timeout: ANSWER_TIMEOUT_MS });
});

test("a scanned PDF shows the scanned-PDF message", async ({ page }) => {
  const title = titleOf(SCANNED_PDF_NAME);
  const message = INGEST_FAILURE_MESSAGES.scanned_pdf;
  await signUpViaUi(page, createTestUser());

  const fileInput = page.getByLabel("Upload a document");
  await waitForHydration(fileInput);
  await fileInput.setInputFiles(fixturePath(SCANNED_PDF_NAME));

  // The upload panel reports it once ingestion has failed...
  await expect(
    page.getByRole("alert").filter({ hasText: message }),
  ).toBeVisible({ timeout: INGEST_TIMEOUT_MS });
  // ...and the document list shows the same reason on the row, with no Retry:
  // a scanned file needs a different file, not another attempt.
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText("Failed", { exact: true })).toBeVisible();
  await expect(row.getByText(message)).toBeVisible();
  await expect(row.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

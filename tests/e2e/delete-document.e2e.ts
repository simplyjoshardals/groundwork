import { expect, test } from "@playwright/test";
import { fixturePath, TEXT_PDF_NAME, titleOf } from "./helpers/fixtures";
import { waitForHydration } from "./helpers/hydration";
import { createTestUser, signUpViaUi } from "./helpers/test-user";

const INGEST_TIMEOUT_MS = 120_000;

/** U5: delete a document with the keyboard only; focus ends on the heading. */
test("a user deletes a document by keyboard", async ({ page }) => {
  const title = titleOf(TEXT_PDF_NAME);
  await signUpViaUi(page, createTestUser());

  const fileInput = page.getByLabel("Upload a document");
  await waitForHydration(fileInput);
  await fileInput.setInputFiles(fixturePath(TEXT_PDF_NAME));

  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText("Ready", { exact: true })).toBeVisible({
    timeout: INGEST_TIMEOUT_MS,
  });

  await row.getByRole("button", { name: `Delete ${title}` }).focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The safe action has focus first, so Enter alone cannot delete by accident.
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Delete document" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Document deleted")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByText("Nothing on the shelf yet.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your documents" }),
  ).toBeFocused();
});

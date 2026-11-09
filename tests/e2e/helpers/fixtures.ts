import { existsSync } from "node:fs";
import path from "node:path";

/** PDFs that already ship with the repo (Tasks 0.6, 1.5 and 4.5). */
export const TEXT_PDF_NAME = "single-column.pdf";
export const SCANNED_PDF_NAME = "scanned.pdf";

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "pdf");

/** Absolute path of a fixture, or a clear error that names the missing file. */
export function fixturePath(fileName: string): string {
  const full = path.join(FIXTURE_DIR, fileName);
  if (!existsSync(full)) {
    throw new Error(
      `E2E fixture not found: ${path.relative(process.cwd(), full)}. Copy it there or fix the name in tests/e2e/helpers/fixtures.ts.`,
    );
  }
  return full;
}

/** The title the app gives an upload: the file name without its extension. */
export function titleOf(fileName: string): string {
  return path.parse(fileName).name;
}

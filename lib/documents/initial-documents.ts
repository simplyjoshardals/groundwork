import type { ListOwnDocumentsResult } from "./list-own-documents";
import type { InitialDocuments } from "@/components/document-list";

/**
 * Shapes the server's first documents read for the shelf. `fetchedAt` is the
 * clock the "stuck" rules start from, taken when the read finished. It lives
 * here, not in the page component, because a render must not call `Date.now`.
 */
export function toInitialDocuments(
  result: ListOwnDocumentsResult,
  now: number = Date.now(),
): InitialDocuments {
  return result.ok
    ? { ok: true, documents: result.documents, fetchedAt: now }
    : { ok: false };
}

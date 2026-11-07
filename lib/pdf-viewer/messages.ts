import type { SignedUrlFailureReason } from "@/lib/storage/documents";

/**
 * User-facing text for viewer failures (Task 3.2). Fixed strings only: PDF.js
 * error messages can contain the signed URL, which is a bearer credential, so
 * they are never shown or logged.
 */

export function describeSignedUrlFailure(
  reason: SignedUrlFailureReason,
): string {
  switch (reason) {
    case "invalid_path":
      return "This document link is not valid.";
    case "not_found":
      return "This document could not be found, or your session cannot open it.";
    case "failed":
      return "The document could not be reached. Check your connection and try again.";
  }
}

/** `name` is the `name` of the error PDF.js reports to `onLoadError`. */
export function describeLoadError(name: string): string {
  switch (name) {
    case "PasswordException":
      return "This PDF needs a password, which the viewer does not support.";
    case "InvalidPDFException":
      return "This file could not be opened as a PDF. It may be damaged.";
    case "MissingPDFException":
      return "The PDF file is missing from storage.";
    case "UnexpectedResponseException":
      return "Storage refused the request. The link may have expired; try again.";
    default:
      return "The PDF could not be loaded. Try again.";
  }
}

export const PAGE_RENDER_ERROR_MESSAGE =
  "This page could not be drawn. Try again.";

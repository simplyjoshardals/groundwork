import { describeSignedUrlFailure } from "@/lib/pdf-viewer/messages";
import type { TextFileFailureReason } from "./load-text-file";

/** User-facing text for a text-file load failure. Fixed strings only. */
export function describeTextFileFailure(reason: TextFileFailureReason): string {
  switch (reason) {
    case "too_large":
      return "This file is larger than the 5 MB limit, so it cannot be shown.";
    case "invalid_text":
      return "This file is not valid UTF-8 text, so it cannot be shown.";
    default:
      return describeSignedUrlFailure(reason);
  }
}

/** Only a transient failure is worth a Retry. */
export function isRetryableTextFailure(reason: TextFileFailureReason): boolean {
  return reason === "failed";
}

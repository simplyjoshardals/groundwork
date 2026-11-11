import { formatResetTime } from "@/lib/ask-client/usage";
import type { LimitReason } from "@/types/ask-stream";

/**
 * Wording for an ingest that was refused by a usage limit (Task 5.3 follow-up).
 * Pure, so it is tested without a browser. The upload itself succeeded: the
 * file is stored and queued, and only processing was refused, so every message
 * says so. As with the ask UI, the client chooses the wording.
 */
export function ingestLimitMessage(
  input: { fileName: string; reason: LimitReason; resetsAt?: string },
  timeZone?: string,
): string {
  const saved = `Uploaded ${input.fileName}, but`;
  switch (input.reason) {
    case "user_limit":
      return `${saved} you've reached today's upload limit, so it hasn't been processed yet. It is saved in your list. Resets at ${formatResetTime(input.resetsAt, timeZone)}.`;
    case "cooldown":
      // No end time is known (the server sends the next UTC midnight).
      return `${saved} you're uploading too quickly, so it hasn't been processed yet. It is saved in your list. Wait a few seconds and try again.`;
    case "global_limit":
      return `${saved} uploads are resting for today, so it hasn't been processed yet. It is saved in your list. Back tomorrow.`;
    default: {
      const unreachable: never = input.reason;
      return unreachable;
    }
  }
}

/**
 * Note shown on a document row after a Retry was refused by a usage limit.
 * The row already names the file, so unlike `ingestLimitMessage` this has no
 * file name and no "Uploaded" lead-in.
 */
export function retryLimitMessage(
  input: { reason: LimitReason; resetsAt?: string },
  timeZone?: string,
): string {
  switch (input.reason) {
    case "user_limit":
      return `You've reached today's upload limit, so this can't be processed yet. Resets at ${formatResetTime(input.resetsAt, timeZone)}.`;
    case "cooldown":
      return "You're retrying too quickly. Wait a few seconds and try again.";
    case "global_limit":
      return "Uploads are resting for today. Try again tomorrow.";
    default: {
      const unreachable: never = input.reason;
      return unreachable;
    }
  }
}

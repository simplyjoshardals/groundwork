import type { StreamUsage } from "@/types/ask-stream";

/**
 * Wording for the question budget and its reset time (Task 5.3). Pure, so it
 * can be tested without a browser; the client component only renders it.
 */

/** Shown when the server's reset time is missing or unreadable. */
const FALLBACK_RESET = "00:00 UTC";

function clock(date: Date, timeZone: string | undefined): string {
  // `h23` keeps midnight as "00:00" instead of "24:00".
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

/**
 * The reset moment as a clock time: the reader's local time with the UTC time
 * beside it ("01:00 (00:00 UTC)"), or just "00:00 UTC" when the two are the
 * same. A missing or invalid `resetsAt` gives "00:00 UTC", the real reset time
 * of every limit. `timeZone` is for tests; the default is the browser's.
 */
export function formatResetTime(
  resetsAt: string | undefined,
  timeZone?: string,
): string {
  if (resetsAt === undefined) return FALLBACK_RESET;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return FALLBACK_RESET;
  const utc = clock(date, "UTC");
  const local = clock(date, timeZone);
  return local === utc ? `${utc} UTC` : `${local} (${utc} UTC)`;
}

export interface UsageLine {
  text: string;
  /** True when no question is left today, so the UI can say so more firmly. */
  lastQuestion: boolean;
}

/** The one-line counter under the question box. */
export function describeUsage(
  usage: StreamUsage,
  timeZone?: string,
): UsageLine {
  const reset = formatResetTime(usage.resetsAt, timeZone);
  if (usage.remaining === 0) {
    return {
      text: `That was your last question today. Resets at ${reset}.`,
      lastQuestion: true,
    };
  }
  const left =
    usage.remaining === 1
      ? "1 question left today"
      : `${usage.remaining} of ${usage.dailyLimit} questions left today`;
  return { text: `${left} · resets at ${reset}`, lastQuestion: false };
}

export interface CounterText {
  /** Short text in the header, e.g. "14 of 20 left". */
  label: string;
  /** Full sentence for screen readers and the tooltip, with the reset time. */
  description: string;
  /** True when nothing is left today, so the UI can switch to the warn tone. */
  empty: boolean;
}

/**
 * The header's question counter. Shorter than `describeUsage` (it sits beside
 * the theme toggle at 360px); the reset time lives in `description`.
 */
export function describeCounter(
  usage: StreamUsage,
  timeZone?: string,
): CounterText {
  const reset = formatResetTime(usage.resetsAt, timeZone);
  if (usage.remaining === 0) {
    return {
      label: "0 left today",
      description: `No questions left today. Resets at ${reset}.`,
      empty: true,
    };
  }
  return {
    label: `${usage.remaining} of ${usage.dailyLimit} left`,
    description: `${usage.remaining} of ${usage.dailyLimit} questions left today. Resets at ${reset}.`,
    empty: false,
  };
}

/**
 * Names of the documents drill scenarios (`/dev-states/documents/<scenario>`).
 * A separate file with no React import, so the server page can validate a
 * route segment without pulling in the client-only source.
 */
export const DOC_SCENARIOS = [
  "mixed",
  "empty",
  "slow",
  "load-error",
  "refresh-error",
  "stuck",
  "retry-notes",
  "cap",
  "paused",
  "scanned",
  "ingest-limit",
  "delete-error",
  "session-ended",
] as const;

export type DocScenario = (typeof DOC_SCENARIOS)[number];

export const DOC_SCENARIO_NOTES: Readonly<Record<DocScenario, string>> = {
  mixed:
    "Every status. The queued row turns processing after 6 s and ready after 14 s; the processing row turns ready after 10 s. Upload and delete work.",
  empty: "Nothing on the shelf. Upload any file: it is processed in 3 s.",
  slow: "No server data: the skeleton shows for 3 s. Upload takes 4 s, processing 8 s, delete 3 s.",
  "load-error":
    "The first read failed: danger banner. Try again fails once more, then works.",
  "refresh-error":
    "A list with a processing row whose refreshes always fail: the stale warn banner.",
  stuck:
    "A stuck queued row and a stuck processing row, each with Retry. Retry works.",
  "retry-notes":
    "Three stuck rows. Retry on each, top to bottom: still processing, unconfirmed, then limit.",
  cap: "Ten documents: the dropzone is disabled and the cap banner shows.",
  paused:
    "Two documents. Any upload is refused with the paused-uploads banner.",
  scanned:
    "Upload any file: it fails as a scanned PDF (banner plus a Failed row with no Retry).",
  "ingest-limit":
    "Upload any file: it is stored, but processing is refused by today's limit.",
  "delete-error":
    "Delete fails once with a network message, then works.",
  "session-ended": "Delete always answers that the session has ended.",
};

/** The server clock for a drill page. A function, so the page itself stays pure. */
export function drillNowMs(): number {
  return Date.now();
}

export function isDocScenario(value: string): value is DocScenario {
  return (DOC_SCENARIOS as readonly string[]).includes(value);
}

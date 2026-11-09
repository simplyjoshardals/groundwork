import { describe, expect, it } from "vitest";
import {
  POLL_MAX_DELAY_MS,
  RETRYABLE_REASONS,
  STALE_PROCESSING_MINUTES_HINT,
  STALE_QUEUED_SECONDS_HINT,
  canRetry,
  isDocumentStatus,
  isInFlight,
  isStuck,
  pollDelayMs,
  statusSignature,
  type DocumentStateFields,
} from "@/lib/documents/document-status";
import { INGEST_FAILURE_MESSAGES } from "@/lib/ingest/failure-messages";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function doc(overrides: Partial<DocumentStateFields>): DocumentStateFields {
  return {
    status: "ready",
    errorReason: null,
    createdAt: ago(60 * MIN),
    processingStartedAt: null,
    ...overrides,
  };
}

describe("isDocumentStatus", () => {
  it.each(["queued", "processing", "ready", "failed"])("accepts %s", (s) => {
    expect(isDocumentStatus(s)).toBe(true);
  });
  it.each(["", "READY", "toString", null, undefined, 3])("rejects %j", (s) => {
    expect(isDocumentStatus(s)).toBe(false);
  });
});

describe("isStuck / isInFlight: processing", () => {
  const processing = (ageMs: number) =>
    doc({ status: "processing", processingStartedAt: ago(ageMs) });

  it("is in flight (not stuck) at exactly the stale window", () => {
    const d = processing(STALE_PROCESSING_MINUTES_HINT * MIN);
    expect(isStuck(d, NOW)).toBe(false);
    expect(isInFlight(d, NOW)).toBe(true);
    expect(canRetry(d, NOW)).toBe(false);
  });

  it("is stuck one millisecond past the stale window", () => {
    const d = processing(STALE_PROCESSING_MINUTES_HINT * MIN + 1);
    expect(isStuck(d, NOW)).toBe(true);
    expect(isInFlight(d, NOW)).toBe(false);
    expect(canRetry(d, NOW)).toBe(true);
  });

  it("is in flight when freshly started", () => {
    expect(isInFlight(processing(5_000), NOW)).toBe(true);
  });

  it("counts a missing or unreadable start time as stuck", () => {
    expect(isStuck(doc({ status: "processing" }), NOW)).toBe(true);
    expect(
      isStuck(
        doc({ status: "processing", processingStartedAt: "not a date" }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("isStuck / isInFlight: queued", () => {
  const queued = (ageMs: number) =>
    doc({ status: "queued", createdAt: ago(ageMs) });

  it("is in flight up to exactly the queued window", () => {
    const d = queued(STALE_QUEUED_SECONDS_HINT * 1000);
    expect(isStuck(d, NOW)).toBe(false);
    expect(isInFlight(d, NOW)).toBe(true);
    expect(canRetry(d, NOW)).toBe(false);
  });

  it("is stuck just past the queued window and can be retried", () => {
    const d = queued(STALE_QUEUED_SECONDS_HINT * 1000 + 1);
    expect(isStuck(d, NOW)).toBe(true);
    expect(isInFlight(d, NOW)).toBe(false);
    expect(canRetry(d, NOW)).toBe(true);
  });

  it("counts an unreadable creation time as stuck", () => {
    expect(isStuck(doc({ status: "queued", createdAt: "garbage" }), NOW)).toBe(
      true,
    );
  });
});

describe("terminal statuses", () => {
  it("ready is never in flight, stuck or retryable", () => {
    const d = doc({ status: "ready" });
    expect(isInFlight(d, NOW)).toBe(false);
    expect(isStuck(d, NOW)).toBe(false);
    expect(canRetry(d, NOW)).toBe(false);
  });

  it("failed is never in flight", () => {
    expect(
      isInFlight(doc({ status: "failed", errorReason: "internal_error" }), NOW),
    ).toBe(false);
  });
});

describe("canRetry: failed", () => {
  const failed = (errorReason: string | null) =>
    doc({ status: "failed", errorReason });

  it.each(["provider_unavailable", "internal_error"])(
    "allows retry for %s",
    (reason) => {
      expect(canRetry(failed(reason), NOW)).toBe(true);
    },
  );

  it.each([
    "scanned_pdf",
    "too_many_pages",
    "file_too_large",
    "unsupported_type",
    "corrupt_file",
    "encrypted_file",
    "empty_document",
  ])("does not allow retry for the file problem %s", (reason) => {
    expect(canRetry(failed(reason), NOW)).toBe(false);
  });

  it.each([null, "something_new", "toString"])(
    "allows retry for an unknown or missing reason (%j)",
    (reason) => {
      expect(canRetry(failed(reason), NOW)).toBe(true);
    },
  );

  it("classifies exactly the reasons that have a failure message", () => {
    expect(Object.keys(RETRYABLE_REASONS).sort()).toEqual(
      Object.keys(INGEST_FAILURE_MESSAGES).sort(),
    );
  });
});

describe("pollDelayMs", () => {
  it("runs 2 s for 5 polls, 5 s for 6 polls, then 10 s", () => {
    const delays = Array.from({ length: 14 }, (_, i) => pollDelayMs(i));
    expect(delays).toEqual([
      2000, 2000, 2000, 2000, 2000, 5000, 5000, 5000, 5000, 5000, 5000, 10000,
      10000, 10000,
    ]);
  });

  it("stays at the maximum for large attempts", () => {
    expect(pollDelayMs(10_000)).toBe(POLL_MAX_DELAY_MS);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.9])(
    "returns a safe delay for %s",
    (attempt) => {
      expect([2000, 10000]).toContain(pollDelayMs(attempt));
    },
  );
});

describe("statusSignature", () => {
  it("changes when a status changes, and when rows are added or removed", () => {
    const a = statusSignature([{ id: "1", status: "queued" }]);
    const b = statusSignature([{ id: "1", status: "processing" }]);
    const c = statusSignature([
      { id: "1", status: "queued" },
      { id: "2", status: "queued" },
    ]);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(statusSignature([{ id: "1", status: "queued" }])).toBe(a);
  });
});

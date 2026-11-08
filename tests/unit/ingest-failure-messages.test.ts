import { describe, expect, it } from "vitest";
import {
  GENERIC_INGEST_FAILURE_MESSAGE,
  INGEST_FAILURE_MESSAGES,
  ingestFailureMessage,
  isIngestFailureReason,
} from "@/lib/ingest/failure-messages";

const REASONS = [
  "scanned_pdf",
  "too_many_pages",
  "file_too_large",
  "unsupported_type",
  "corrupt_file",
  "encrypted_file",
  "empty_document",
  "provider_unavailable",
  "internal_error",
] as const;

describe("INGEST_FAILURE_MESSAGES", () => {
  it("has exactly one message per documents.error_reason code", () => {
    expect(Object.keys(INGEST_FAILURE_MESSAGES).sort()).toEqual(
      [...REASONS].sort(),
    );
  });

  it.each(REASONS)("%s has a plain, readable message", (reason) => {
    const message = INGEST_FAILURE_MESSAGES[reason];
    expect(message.length).toBeGreaterThan(10);
    // Fixed text: no code, path, status or template leftovers.
    expect(message).not.toMatch(/[_{}]|undefined|\bHTTP\b|Error\b|\.tsx?\b/);
    expect(ingestFailureMessage(reason)).toBe(message);
  });

  it("states the limits from the shared constants", () => {
    expect(INGEST_FAILURE_MESSAGES.too_many_pages).toContain("30");
    expect(INGEST_FAILURE_MESSAGES.file_too_large).toContain("5 MB");
  });
});

describe("isIngestFailureReason", () => {
  it.each(REASONS)("accepts %s", (reason) => {
    expect(isIngestFailureReason(reason)).toBe(true);
  });

  it.each([
    ["an unknown code", "weird"],
    ["an empty string", ""],
    ["a prototype key", "toString"],
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    ["null", null],
    ["a number", 5],
    ["an object", { reason: "scanned_pdf" }],
  ])("rejects %s", (_name, value) => {
    expect(isIngestFailureReason(value)).toBe(false);
  });
});

describe("ingestFailureMessage", () => {
  it.each([
    ["an unknown code", "weird"],
    ["null", null],
    ["undefined", undefined],
    ["a prototype key", "toString"],
    ["server-looking text", "Error: at /srv/app/stack.ts:1 secret"],
  ])("falls back to the generic message for %s", (_name, value) => {
    const message = ingestFailureMessage(value);
    expect(message).toBe(GENERIC_INGEST_FAILURE_MESSAGE);
    expect(message).not.toMatch(/secret|stack/);
  });
});

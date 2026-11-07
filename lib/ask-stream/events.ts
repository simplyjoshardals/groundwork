import type {
  AskStreamEvent,
  StreamErrorCode,
  StreamSource,
} from "@/types/ask-stream";
import { StreamProtocolError } from "./errors";

/**
 * Encoding and validation of single stream events. No `server-only` import on
 * purpose: the server encodes, the browser validates, and both use this file.
 */

export type TerminalStreamEvent = Extract<
  AskStreamEvent,
  { type: "done" | "not_found" | "limit" | "error" }
>;

/** True for the events that legitimately end a stream. */
export function isTerminalStreamEvent(
  event: AskStreamEvent,
): event is TerminalStreamEvent {
  return (
    event.type === "done" ||
    event.type === "not_found" ||
    event.type === "limit" ||
    event.type === "error"
  );
}

/**
 * Encodes one event as an SSE frame. `JSON.stringify` never emits a raw CR or
 * LF, so the payload always fits on a single `data:` line.
 */
export function encodeStreamEvent(event: AskStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// `Record` makes the compiler flag this table if a code is added to the type.
const ERROR_CODES: Record<StreamErrorCode, true> = {
  search_unavailable: true,
  llm_unavailable: true,
  interrupted: true,
  internal_error: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is StreamErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ERROR_CODES, value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function invalid(type: string, reason: string): never {
  throw new StreamProtocolError(`Invalid "${type}" event: ${reason}.`);
}

function parseText(value: unknown, type: string, field: string): string {
  if (typeof value !== "string") invalid(type, `"${field}" must be a string`);
  return value;
}

function parseIntegers(value: unknown, type: string, field: string): number[] {
  if (!Array.isArray(value)) invalid(type, `"${field}" must be an array`);
  return value.map((item: unknown) => {
    if (typeof item !== "number" || !Number.isInteger(item)) {
      invalid(type, `"${field}" must contain only integers`);
    }
    return item;
  });
}

function parseSources(
  value: unknown,
  type: string,
  field: string,
): StreamSource[] {
  if (!Array.isArray(value)) invalid(type, `"${field}" must be an array`);
  return value.map((item: unknown, index) => {
    const where = `${field}[${index}]`;
    if (!isRecord(item)) invalid(type, `"${where}" must be an object`);
    if (!isPositiveInteger(item.marker)) {
      invalid(type, `"${where}.marker" must be a positive integer`);
    }
    if (!isPositiveInteger(item.page)) {
      invalid(type, `"${where}.page" must be a positive integer`);
    }
    if (!isPositiveInteger(item.chunkId)) {
      invalid(type, `"${where}.chunkId" must be a positive integer`);
    }
    // Rebuilt field by field, so unknown extras never leak into typed values.
    return {
      marker: item.marker,
      documentId: parseText(item.documentId, type, `${where}.documentId`),
      chunkId: item.chunkId,
      documentTitle: parseText(
        item.documentTitle,
        type,
        `${where}.documentTitle`,
      ),
      page: item.page,
      snippet: parseText(item.snippet, type, `${where}.snippet`),
    };
  });
}

/**
 * Validates one decoded payload.
 *
 * - A known event type with a valid shape returns the typed event. Unknown
 *   extra fields are ignored, so the contract can grow additively.
 * - An event type this client does not know returns `null`; the caller skips it.
 * - A known type with an invalid shape, or a payload that is not an object with
 *   a string `type`, throws `StreamProtocolError`.
 */
export function parseStreamEvent(json: unknown): AskStreamEvent | null {
  if (!isRecord(json)) {
    throw new StreamProtocolError("Stream event is not a JSON object.");
  }
  const type = json.type;
  if (typeof type !== "string") {
    throw new StreamProtocolError('Stream event has no string "type".');
  }

  switch (type) {
    case "sources":
      return { type, sources: parseSources(json.sources, type, "sources") };
    case "token":
      return { type, text: parseText(json.text, type, "text") };
    case "done":
      return {
        type,
        citations: parseIntegers(json.citations, type, "citations"),
        invalidCitations: parseIntegers(
          json.invalidCitations,
          type,
          "invalidCitations",
        ),
      };
    case "not_found":
      // `closest` is optional: absent or undefined means "none supplied".
      return json.closest === undefined
        ? { type }
        : { type, closest: parseSources(json.closest, type, "closest") };
    case "limit":
      if (json.scope !== "user" && json.scope !== "global") {
        invalid(type, '"scope" must be "user" or "global"');
      }
      return { type, scope: json.scope };
    case "error":
      if (!isErrorCode(json.code)) invalid(type, '"code" is not a known code');
      return {
        type,
        code: json.code,
        message: parseText(json.message, type, "message"),
      };
    default:
      return null;
  }
}

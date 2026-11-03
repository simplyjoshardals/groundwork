/**
 * Errors thrown by the client stream parser. They live in their own module so
 * `events.ts` and `parse.ts` can both use them without importing each other.
 */

/** Base class, so callers can catch every parser failure with one check. */
export class AskStreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AskStreamError";
  }
}

/** The server sent bytes that break the contract: bad JSON or a bad shape. */
export class StreamProtocolError extends AskStreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StreamProtocolError";
  }
}

/** The stream closed cleanly without a terminal event (`done`, etc.). */
export class StreamIncompleteError extends AskStreamError {
  constructor() {
    super("The response ended before the answer was complete.");
    this.name = "StreamIncompleteError";
  }
}

/** Reading the response failed (network drop, reset). `cause` is the original. */
export class StreamInterruptedError extends AskStreamError {
  constructor(cause: unknown) {
    super("The response stream was interrupted.", { cause });
    this.name = "StreamInterruptedError";
  }
}

/**
 * Public entry point for the answer-stream contract. Safe to import from both
 * server and client code (no `server-only`): the server uses
 * `encodeStreamEvent`, the browser uses `readAskStream`.
 */

export type {
  AskStreamEvent,
  StreamErrorCode,
  StreamSource,
} from "@/types/ask-stream";
export {
  AskStreamError,
  StreamIncompleteError,
  StreamInterruptedError,
  StreamProtocolError,
} from "./errors";
export {
  encodeStreamEvent,
  isTerminalStreamEvent,
  parseStreamEvent,
  type TerminalStreamEvent,
} from "./events";
export { readAskStream } from "./parse";

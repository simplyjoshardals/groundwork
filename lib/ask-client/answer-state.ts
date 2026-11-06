import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";
import {
  failureForErrorCode,
  failureForLimit,
  type AskFailure,
} from "./failures";

/**
 * State of one question and its streamed answer, as a pure reducer so it can
 * be tested without a browser. `loading` means the request is sent and nothing
 * has arrived; `streaming` means at least one event has.
 */
export type AskStatus =
  "idle" | "loading" | "streaming" | "done" | "not_found" | "limit" | "error";

export interface AskState {
  status: AskStatus;
  /** The question being answered (or last answered). */
  question: string;
  /** `null` until the `sources` event arrives; `[]` means nothing was found. */
  sources: StreamSource[] | null;
  /** Text so far. Kept when a failure interrupts the stream. */
  answer: string;
  /** Set for `error`, `not_found` and `limit`. */
  notice: AskFailure | null;
  /** Nearest passages from a `not_found` event; empty otherwise. */
  closest: StreamSource[];
}

export type AskAction =
  | { type: "submit"; question: string }
  | { type: "event"; event: AskStreamEvent }
  | { type: "failed"; failure: AskFailure };

export const initialAskState: AskState = {
  status: "idle",
  question: "",
  sources: null,
  answer: "",
  notice: null,
  closest: [],
};

/** Headline of the not-found state (Task 2.7 shows it beside `closest`). */
const NOT_FOUND: AskFailure = {
  message: "I couldn't find that in the documents.",
  retryable: false,
};

function isActive(state: AskState): boolean {
  return state.status === "loading" || state.status === "streaming";
}

function applyEvent(state: AskState, event: AskStreamEvent): AskState {
  switch (event.type) {
    case "sources":
      return { ...state, status: "streaming", sources: event.sources };
    case "token":
      return {
        ...state,
        status: "streaming",
        answer: state.answer + event.text,
      };
    case "done":
      return { ...state, status: "done" };
    case "not_found":
      return {
        ...state,
        status: "not_found",
        notice: NOT_FOUND,
        closest: event.closest ?? [],
      };
    case "limit":
      return {
        ...state,
        status: "limit",
        notice: failureForLimit(event.scope),
      };
    case "error":
      return {
        ...state,
        status: "error",
        notice: failureForErrorCode(event.code),
      };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case "submit":
      return {
        ...initialAskState,
        status: "loading",
        question: action.question,
      };
    case "event":
      // Events that arrive after a terminal one (or before any submit) are stale.
      return isActive(state) ? applyEvent(state, action.event) : state;
    case "failed":
      return isActive(state)
        ? { ...state, status: "error", notice: action.failure }
        : state;
  }
}

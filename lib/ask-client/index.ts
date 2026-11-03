/**
 * Browser-side pieces of the ask UI (Task 1.10). No `server-only` import: the
 * client component uses all of it.
 */
export {
  askReducer,
  initialAskState,
  type AskAction,
  type AskState,
  type AskStatus,
} from "./answer-state";
export {
  AskHttpError,
  AskIdleTimeoutError,
  AskNetworkError,
  describeFailure,
  isAbortError,
  type AskFailure,
} from "./failures";
export {
  IDLE_TIMEOUT_MS,
  requestAnswer,
  type RequestAnswerOptions,
} from "./request-answer";

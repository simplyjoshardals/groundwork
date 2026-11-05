import "server-only";

/** Public entry point for question-answering features. Server-only. */

export {
  DEFAULT_MATCH_COUNT,
  SearchFailedError,
  retrieveChunks,
} from "./retrieve";
export type { MatchedChunk, RetrieveChunksInput } from "./retrieve";
export { checkRefusalGate1 } from "./refusal";
export type { PassageSimilarity, RefusalDecision } from "./refusal";

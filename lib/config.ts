/**
 * Tunable numbers that are not secrets, in one place (ARCHITECTURE.md,
 * "lib/config.ts"). Plain constants, no `server-only`: the eval scripts and
 * tests import them too. Other limits still live next to the code that owns
 * them (`lib/ask/limits.ts`, `DEFAULT_MATCH_COUNT` in `features/qa/retrieve.ts`);
 * moving them here is not part of Task 2.3.
 */

/**
 * Refusal gate #1 (Task 2.4): when the best passage's cosine similarity is
 * BELOW this value (`similarity < threshold`), the LLM is not called.
 *
 * Provisional and deliberately conservative. On the Task 2.2 baseline the
 * answerable and unanswerable questions overlap (0.6705 to 0.7142), so no
 * value separates them. 0.65 sits between the lowest unanswerable score
 * (0.6282) and the lowest answerable score (0.6705): no answerable question is
 * refused, and only clearly off-topic questions are. Gate #2 (the sentinel,
 * Task 2.5) has to do the rest. Calibration data and reasoning:
 * `docs/decisions.md` (2026-11-05) and `yarn eval:calibrate`.
 */
export const REFUSAL_SIMILARITY_THRESHOLD = 0.65;

/**
 * The embedding model `REFUSAL_SIMILARITY_THRESHOLD` was calibrated for.
 * Similarity scores are specific to a model, so a different embedder needs a
 * new baseline and a new threshold; `yarn eval:calibrate` flags a mismatch.
 */
export const REFUSAL_THRESHOLD_EMBEDDING_MODEL = "gemini-embedding-2";
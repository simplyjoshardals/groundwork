/**
 * Longest question accepted, in characters (after trimming). Kept in its own
 * import-free module so the browser can use it without bundling zod, which
 * `request.ts` needs. The server still enforces the limit.
 */
export const MAX_QUESTION_LENGTH = 500;

/**
 * One-line description of a thrown value for server logs: name and message
 * only. Provider errors never carry bodies or keys (lib/providers/errors.ts),
 * and nothing else is logged, so this is safe to print.
 */
export function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : "A non-Error value was thrown";
}

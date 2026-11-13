/**
 * Task 5.10. Keeps secrets and long text out of server logs.
 *
 * `redactSecrets` is a safety net, not the main defence: the structured request
 * line (`request-log.ts`) never carries an error message at all. This is for the
 * free-text detail lines (`describeError`), which do carry one, so a message
 * that happens to echo a key or a token cannot reach the logs.
 *
 * Pure and free of `server-only`, so tests and scripts can import it.
 */

const SECRET_PATTERNS: readonly RegExp[] = [
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /gsk_[A-Za-z0-9]{10,}/g,
  // A JWT: three base64url parts, the first two starting with `eyJ`.
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export const REDACTED = "[redacted]";

/** Longest message `toLogMessage` returns, in characters. */
export const MAX_LOGGED_MESSAGE_LENGTH = 300;

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    text,
  );
}

/**
 * Redacts, keeps the first line only (a stack or a multi-line provider body
 * stays out) and caps the length.
 */
export function toLogMessage(text: string): string {
  const firstLine = redactSecrets(text).split(/\r?\n/, 1)[0].trim();
  return firstLine.length <= MAX_LOGGED_MESSAGE_LENGTH
    ? firstLine
    : `${firstLine.slice(0, MAX_LOGGED_MESSAGE_LENGTH - 1)}…`;
}

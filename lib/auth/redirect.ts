/**
 * Post-auth redirect targets come from the URL (`?next=`), so they are
 * untrusted. Only same-site, relative paths are accepted; everything else
 * (absolute URLs, protocol-relative `//host`, backslash tricks, control
 * characters) falls back to the home page. The auth pages themselves are
 * refused too, so a crafted link cannot bounce the user between them.
 */

const FALLBACK = "/";
const MAX_LENGTH = 512;
const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";
const AUTH_PATHS = ["/sign-in", "/sign-up", "/auth"];

function hasForbiddenCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Control characters, DEL and backslash (browsers treat `\` like `/`).
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK;
  if (raw.length === 0 || raw.length > MAX_LENGTH) return FALLBACK;
  if (!raw.startsWith("/") || raw.startsWith("//")) return FALLBACK;
  if (hasForbiddenCharacter(raw)) return FALLBACK;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return FALLBACK;

  const path = url.pathname;
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return FALLBACK;
  }
  return `${path}${url.search}`;
}

/**
 * Security response headers (Task 5.8). Pure, with no `server-only` marker and
 * no alias imports, because `next.config.ts` loads it before Next is running.
 *
 * The CSP is static (one policy for every response), not per-request with a
 * nonce. A nonce needs `proxy.ts` to set a header on every request and forces
 * every page to render dynamically; that is a larger change than "basic
 * security headers". The cost is `'unsafe-inline'` in `script-src`, which
 * Next's inline hydration scripts need, so this CSP does not stop an injected
 * inline script. It does still stop foreign script hosts, framing, plugins,
 * `<base>` tampering, form hijacking and requests to unlisted origins.
 * Recorded in docs/decisions.md (2026-11-13, Task 5.8).
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeaderOptions {
  /** `NEXT_PUBLIC_SUPABASE_URL`. Undefined only for a build without env (CI). */
  supabaseUrl: string | undefined;
  /** `next dev`: adds what the dev server needs (eval, websocket for HMR). */
  isDev: boolean;
}

/** Turnstile needs script-src and frame-src only (Cloudflare's CSP page). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The origin of the Supabase API, or `null` when no URL is configured. An
 * invalid value throws, so a typo fails the build instead of shipping a CSP
 * that silently blocks the app. The message never contains the value.
 */
export function supabaseOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not a valid URL, so the Content-Security-Policy cannot name it.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL for the Content-Security-Policy.",
    );
  }
  return url.origin;
}

export function buildContentSecurityPolicy(
  options: SecurityHeaderOptions,
): string {
  const supabase = supabaseOrigin(options.supabaseUrl);
  const { isDev } = options;

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        "'unsafe-inline'", // Next's inline hydration scripts; see the file comment.
        ...(isDev ? ["'unsafe-eval'"] : []), // dev-only: React/Turbopack debugging
        TURNSTILE_ORIGIN,
      ],
    ],
    // React `style` attributes (the PDF highlight layer) need inline styles.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // The PDF pages are drawn to <canvas>; blob:/data: cover what PDF.js makes.
    ["img-src", ["'self'", "data:", "blob:"]],
    // next/font self-hosts Geist at build time.
    ["font-src", ["'self'"]],
    [
      "connect-src",
      [
        "'self'",
        // Auth, REST, Storage uploads and the signed-URL fetch of the PDF.
        ...(supabase === null ? [] : [supabase]),
        ...(isDev ? ["ws:", "wss:"] : []), // dev server hot reload
      ],
    ],
    // The PDF.js worker is a same-origin bundled file; blob: is PDF.js's fallback.
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", [TURNSTILE_ORIGIN]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function buildSecurityHeaders(
  options: SecurityHeaderOptions,
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(options),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Older browsers ignore `frame-ancestors`; this covers them.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The app uses none of these; denying them also blocks embedded content.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];
  if (!options.isDev) {
    // One year, no `includeSubDomains` or `preload`: both are hard to undo and
    // not needed here. Browsers ignore HSTS over plain http (local `next start`).
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  }
  return headers;
}

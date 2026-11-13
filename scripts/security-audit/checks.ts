/**
 * Pure helpers for the Task 5.8 API checks (`yarn security:api`). No network,
 * no Supabase: the script does the requests and this file decides whether each
 * answer is the expected one, so the decisions can be unit-tested.
 *
 * Nothing here ever puts a response body, token or id into a result's detail:
 * a report is meant to be pasted into an issue or a decision log.
 */

export type Outcome = "pass" | "fail" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  outcome: Outcome;
  detail: string;
}

export const pass = (id: string, title: string, detail = ""): CheckResult => ({
  id,
  title,
  outcome: "pass",
  detail,
});
export const fail = (
  id: string,
  title: string,
  detail: string,
): CheckResult => ({
  id,
  title,
  outcome: "fail",
  detail,
});
export const skip = (
  id: string,
  title: string,
  detail: string,
): CheckResult => ({
  id,
  title,
  outcome: "skip",
  detail,
});

/** The statuses DATA_MODEL §7.2 accepts for each "must be refused" check. */
export const EXPECTED_STATUS = {
  A2: [401, 403],
  A3: [401, 403],
  A4: [401, 403],
  A5: [400, 403],
  A6: [401, 403],
  A7: [401, 403, 404],
  A9: [401, 403],
  A10: [400, 404],
  A14: [400, 404],
  A15a: [400, 413],
} as const satisfies Record<string, readonly number[]>;

export function expectStatus(
  id: string,
  title: string,
  status: number,
  allowed: readonly number[],
): CheckResult {
  const wanted = allowed.join("/");
  return allowed.includes(status)
    ? pass(id, title, `status ${status}`)
    : fail(id, title, `got status ${status}, expected ${wanted}`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** True for a body that is exactly an empty JSON array. */
export function isEmptyJsonArray(body: string): boolean {
  const parsed = parseJson(body);
  return Array.isArray(parsed) && parsed.length === 0;
}

/**
 * Storage's "refused by policy". Some Storage versions answer an RLS refusal
 * with HTTP 400 and `statusCode: "403"` in the body, so a bare 400 is not
 * enough: it must also say 403 or name the row-level security policy. That
 * keeps a malformed request (also 400) from passing for the wrong reason.
 */
export function isStorageDenied(status: number, body: string): boolean {
  if (status === 403) return true;
  if (status !== 400) return false;
  return /"statusCode"\s*:\s*"?403"?|row-level security/i.test(body);
}

// Values of these keys are safe to compare and show (fixed words, not data).
const SAFE_KEYS = new Set([
  "error",
  "reason",
  "status",
  "statusCode",
  "message",
  "code",
  "type",
]);

/**
 * A short, value-free description of a response, used to compare two answers.
 * JSON objects: status, key names and the fixed-word fields. Arrays: length.
 * Streams (anything with `"type":"..."` events): the event names in order.
 * Ids, titles and numbers never appear.
 */
export function responseShape(status: number, body: string): string {
  const parsed = parseJson(body);
  if (Array.isArray(parsed)) return `${status} array(${parsed.length})`;
  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map((key) => {
        const value = record[key];
        return SAFE_KEYS.has(key) &&
          (typeof value === "string" || typeof value === "number")
          ? `${key}=${String(value)}`
          : key;
      });
    return `${status} {${parts.join(",")}}`;
  }
  const events = [...body.matchAll(/"type"\s*:\s*"([a-z_]+)"/g)].map(
    (m) => m[1],
  );
  if (events.length > 0) return `${status} events[${events.join(",")}]`;
  return `${status} text`;
}

/** Passes when two responses (for "someone else's" vs "does not exist") match. */
export function sameShape(
  id: string,
  title: string,
  foreign: { status: number; body: string },
  missing: { status: number; body: string },
): CheckResult {
  const a = responseShape(foreign.status, foreign.body);
  const b = responseShape(missing.status, missing.body);
  return a === b
    ? pass(id, title, `both answer ${a}`)
    : fail(id, title, `someone else's: ${a}; missing: ${b}`);
}

/** Kinds of things an error body must never contain (names only, no matches). */
export function findLeaks(body: string): string[] {
  const kinds: Array<[string, RegExp]> = [
    ["stack trace", /\n\s+at\s+\S+.*(?::\d+:\d+|\(<anonymous>\))/],
    [
      "file path",
      /node_modules|\/home\/|[A-Za-z]:\\\\|\.(?:ts|tsx|js|mjs):\d+/,
    ],
    [
      "SQL or Postgres detail",
      /\b(?:PGRST\d*|SQLSTATE|violates|relation "[^"]+"|pg_catalog)\b/i,
    ],
    ["Supabase key", /sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]{10,}\./],
    ["provider key", /AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{20,}/],
  ];
  return kinds
    .filter(([, pattern]) => pattern.test(body))
    .map(([name]) => name);
}

/** `name -> sources` of a CSP string. Unknown shapes simply give fewer entries. */
export function parseCsp(csp: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) result.set(name.toLowerCase(), sources);
  }
  return result;
}

/**
 * Checks the security headers of a response. `prod` is true when the app under
 * test is `yarn start`: only then are HSTS and "no unsafe-eval" required,
 * because the dev server needs eval and is never served over https.
 */
export function checkSecurityHeaders(
  get: (name: string) => string | null,
  options: { prod: boolean },
): CheckResult[] {
  const results: CheckResult[] = [];
  const check = (id: string, title: string, problems: string[]) =>
    results.push(
      problems.length === 0
        ? pass(id, title)
        : fail(id, title, problems.join("; ")),
    );

  check(
    "H1",
    "X-Content-Type-Options is nosniff",
    get("x-content-type-options")?.toLowerCase() === "nosniff"
      ? []
      : ["missing or not nosniff"],
  );
  check(
    "H2",
    "X-Frame-Options is DENY",
    get("x-frame-options")?.toUpperCase() === "DENY"
      ? []
      : ["missing or not DENY"],
  );
  check(
    "H3",
    "Referrer-Policy is set",
    get("referrer-policy") ? [] : ["missing"],
  );
  check(
    "H4",
    "Permissions-Policy is set",
    get("permissions-policy") ? [] : ["missing"],
  );

  const cspText = get("content-security-policy");
  if (!cspText) {
    check("H5", "Content-Security-Policy is strict enough", ["missing"]);
  } else {
    const csp = parseCsp(cspText);
    const problems: string[] = [];
    const has = (directive: string, source: string) =>
      csp.get(directive)?.includes(source) === true;
    if (!has("default-src", "'self'"))
      problems.push("default-src is not 'self'");
    if (!has("object-src", "'none'")) problems.push("object-src is not 'none'");
    if (!has("base-uri", "'self'")) problems.push("base-uri is not 'self'");
    if (!has("frame-ancestors", "'none'"))
      problems.push("frame-ancestors is not 'none'");
    for (const source of csp.get("script-src") ?? []) {
      if (
        source === "*" ||
        source === "http:" ||
        source === "https:" ||
        source === "data:"
      ) {
        problems.push(`script-src allows ${source}`);
      }
    }
    if (options.prod && has("script-src", "'unsafe-eval'")) {
      problems.push("script-src has 'unsafe-eval' in production");
    }
    check("H5", "Content-Security-Policy is strict enough", problems);
  }

  results.push(
    options.prod
      ? get("strict-transport-security")?.includes("max-age=")
        ? pass("H6", "Strict-Transport-Security is set")
        : fail("H6", "Strict-Transport-Security is set", "missing")
      : skip(
          "H6",
          "Strict-Transport-Security is set",
          "only checked with --prod",
        ),
  );
  check(
    "H7",
    "No X-Powered-By header",
    get("x-powered-by") === null ? [] : ["X-Powered-By is present"],
  );
  return results;
}

export function summarize(results: readonly CheckResult[]): {
  passed: number;
  failed: number;
  skipped: number;
} {
  return {
    passed: results.filter((r) => r.outcome === "pass").length,
    failed: results.filter((r) => r.outcome === "fail").length,
    skipped: results.filter((r) => r.outcome === "skip").length,
  };
}

export function renderReport(results: readonly CheckResult[]): string {
  const label: Record<Outcome, string> = {
    pass: "PASS",
    fail: "FAIL",
    skip: "SKIP",
  };
  const lines = results.map(
    (r) =>
      `${label[r.outcome]}  ${r.id.padEnd(5)} ${r.title}${r.detail ? ` (${r.detail})` : ""}`,
  );
  const { passed, failed, skipped } = summarize(results);
  lines.push("", `${passed} passed, ${failed} failed, ${skipped} skipped`);
  return lines.join("\n");
}

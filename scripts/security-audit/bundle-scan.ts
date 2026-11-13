/**
 * Looks for secrets in the files the browser downloads (`.next/static`).
 * Findings name the file and the kind of match, never the matched text, so the
 * output is safe to paste anywhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface ExactSecret {
  /** The variable name, for the report. */
  name: string;
  value: string;
}

export interface BundleFinding {
  file: string;
  reason: string;
}

/** Variable names that belong on the server only. Matched by name in the bundle. */
export const SERVER_ENV_NAMES = [
  "SUPABASE_SECRET_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
] as const;

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".json",
  ".txt",
  ".map",
]);
const MIN_EXACT_LENGTH = 16;

const PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "Supabase secret key (sb_secret_)",
    pattern: /sb_secret_[A-Za-z0-9_-]{8,}/,
  },
  { reason: "Google API key (AIza...)", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { reason: "Groq API key (gsk_...)", pattern: /gsk_[A-Za-z0-9]{20,}/ },
];

const JWT_PATTERN =
  /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

/** True when the JWT payload says `role: service_role`. Never throws. */
function isServiceRolePayload(payloadSegment: string): boolean {
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return (
      typeof payload === "object" &&
      payload !== null &&
      (payload as { role?: unknown }).role === "service_role"
    );
  } catch {
    return false;
  }
}

/** Reasons the text counts as a leak. Empty when it is clean. */
export function scanText(
  text: string,
  exact: readonly ExactSecret[],
): string[] {
  const reasons: string[] = [];
  for (const { reason, pattern } of PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  for (const match of text.matchAll(JWT_PATTERN)) {
    if (isServiceRolePayload(match[1])) {
      reasons.push("service-role JWT");
      break;
    }
  }
  for (const name of SERVER_ENV_NAMES) {
    if (text.includes(name)) reasons.push(`server variable name ${name}`);
  }
  for (const { name, value } of exact) {
    if (value.length >= MIN_EXACT_LENGTH && text.includes(value)) {
      reasons.push(`exact value of ${name}`);
    }
  }
  return reasons;
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

export interface ScanResult {
  filesScanned: number;
  findings: BundleFinding[];
}

/** Scans every text-like file under `dir`. A `.map` file is itself a finding. */
export function scanDirectory(
  dir: string,
  exact: readonly ExactSecret[],
): ScanResult {
  const findings: BundleFinding[] = [];
  let filesScanned = 0;
  for (const file of listFiles(dir)) {
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const relative = path.relative(dir, file);
    filesScanned += 1;
    if (extension === ".map") {
      findings.push({ file: relative, reason: "source map is published" });
    }
    for (const reason of scanText(readFileSync(file, "utf8"), exact)) {
      findings.push({ file: relative, reason });
    }
  }
  return { filesScanned, findings };
}

/**
 * Secrets to look for by exact value: every non-public variable in an env file
 * whose name suggests a credential. `NEXT_PUBLIC_*` is public by design.
 */
export function secretsFromEnv(
  env: Record<string, string | undefined>,
): ExactSecret[] {
  const result: ExactSecret[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("NEXT_PUBLIC_") || !value) continue;
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(name)) result.push({ name, value });
  }
  return result;
}

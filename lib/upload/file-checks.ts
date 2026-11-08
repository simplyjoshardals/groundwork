import { MAX_FILE_BYTES } from "@/lib/pdf/limits";

/**
 * Client-side checks and naming for uploads (Task 4.3). These are a courtesy
 * so a bad file fails before any request; they are not the security boundary.
 * The real enforcement is server-side: the `documents` constraints and insert
 * trigger, the storage policies and bucket limits (migrations 0003 and 0007),
 * and ingestion, which sniffs the content.
 */

/**
 * UX hint only: mirrors `app_config.max_docs_per_user`, which clients cannot
 * read. If the two drift apart the insert trigger still decides.
 */
export const MAX_DOCS_PER_USER_HINT = 10;

/** Value for the file input's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = ".pdf,.txt,.md";

/** `documents_storage_path_shape` allows 1 to 100 characters of `[A-Za-z0-9._-]`. */
const MAX_STORAGE_FILE_NAME_LENGTH = 100;
/** `documents_filename_shape` and `documents_title_shape`, in characters. */
const MAX_ORIGINAL_FILENAME_LENGTH = 255;
const MAX_TITLE_LENGTH = 200;

const FALLBACK_STEM = "document";
export const FALLBACK_TITLE = "Untitled document";

export type UploadMimeType = "application/pdf" | "text/plain" | "text/markdown";

const MAX_FILE_MB = MAX_FILE_BYTES / (1024 * 1024);

function mimeForExtension(extension: string): UploadMimeType | null {
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    default:
      return null;
  }
}

function extensionOf(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot === -1 ? "" : trimmed.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type comes from the extension, never from `File.type`: browsers
 * report Markdown as `application/octet-stream` or an empty string, which the
 * bucket's MIME allowlist would reject (DATA_MODEL 2.7).
 */
export function mimeTypeForFileName(name: string): UploadMimeType | null {
  return mimeForExtension(extensionOf(name));
}

export type FileRejectionReason = "unsupported_type" | "empty" | "too_large";

export type FileCheckResult =
  | { ok: true; mimeType: UploadMimeType }
  | { ok: false; reason: FileRejectionReason; message: string };

export function validateUploadFile(file: {
  readonly name: string;
  readonly size: number;
}): FileCheckResult {
  const mimeType = mimeTypeForFileName(file.name);
  if (mimeType === null) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: "Only PDF, TXT and Markdown (.md) files can be uploaded.",
    };
  }
  if (file.size < 1) {
    return { ok: false, reason: "empty", message: "That file is empty." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: `That file is larger than ${MAX_FILE_MB} MB.`,
    };
  }
  return { ok: true, mimeType };
}

/** Removes ASCII and C1 control characters and line/paragraph separators. */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isControl =
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029;
    if (!isControl) out += char;
  }
  return out;
}

function truncateCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

/** Cuts the stem, not the extension, so a long name still ends in `.pdf`. */
function truncateKeepingExtension(value: string, max: number): string {
  if (Array.from(value).length <= max) return value;
  const dot = value.lastIndexOf(".");
  const extension = dot === -1 ? "" : value.slice(dot);
  const stem = dot === -1 ? value : value.slice(0, dot);
  const extensionLength = Array.from(extension).length;
  if (extensionLength >= max) return truncateCodePoints(value, max);
  return truncateCodePoints(stem, max - extensionLength) + extension;
}

/**
 * The file name as stored in `documents.original_filename`: what the user
 * picked, minus control characters, within the column's 255-character limit.
 * It is display data only and never part of a path.
 */
export function cleanOriginalFilename(originalName: string): string {
  return truncateKeepingExtension(
    stripControlCharacters(originalName).trim(),
    MAX_ORIGINAL_FILENAME_LENGTH,
  );
}

/** `documents.title`: the file name without a known extension, at most 200 characters. */
export function titleFromFileName(originalName: string): string {
  const cleaned = stripControlCharacters(originalName).trim();
  const dot = cleaned.lastIndexOf(".");
  const stem =
    dot !== -1 && mimeForExtension(cleaned.slice(dot + 1).toLowerCase())
      ? cleaned.slice(0, dot)
      : cleaned;
  return truncateCodePoints(stem.trim(), MAX_TITLE_LENGTH).trim() || FALLBACK_TITLE;
}

/**
 * The last path segment: ASCII `[A-Za-z0-9._-]` only, 1 to 100 characters, so
 * it always satisfies `documents_storage_path_shape`. Accents are folded
 * ("Résumé" becomes "Resume"), every other run of unsupported characters
 * becomes one `_`, and leading or trailing dots and underscores are dropped,
 * so the name can never be `.` or `..` and never looks like a traversal.
 * A name with nothing usable left becomes `document`. The extension is kept
 * (lowercased) even when the stem is cut to fit.
 */
export function safeStorageFileName(originalName: string): string {
  const name = originalName.trim();
  const dot = name.lastIndexOf(".");
  const rawStem = dot === -1 ? name : name.slice(0, dot);
  const extension =
    dot === -1
      ? ""
      : name
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 10);
  const suffix = extension ? `.${extension}` : "";

  const ascii = rawStem
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_");
  const room = MAX_STORAGE_FILE_NAME_LENGTH - suffix.length;
  const stem =
    ascii.slice(0, room).replace(/^[._]+|[._]+$/g, "") || FALLBACK_STEM;
  return stem + suffix;
}

/**
 * Typed extraction errors (Task 1.5).
 *
 * Every failure caused by the uploaded file is an `ExtractionError` with a
 * stable `code`. The codes are exactly the `documents.error_reason` values in
 * DATA_MODEL.md, so ingestion can store `error.code` without a lookup table.
 *
 * Messages are fixed strings. They never contain library output, file names,
 * or file content, and no `cause` is attached, so an error is safe to log and
 * callers decide what (if anything) reaches a user.
 *
 * Wrong argument types are programmer errors and throw `TypeError` instead
 * (the same convention as lib/chunking).
 *
 * No `server-only` marker: this module is pure and carries no runtime
 * behaviour (same exemption as lib/providers/errors.ts).
 */

export type ExtractionErrorCode =
  | "scanned_pdf"
  | "too_many_pages"
  | "file_too_large"
  | "unsupported_type"
  | "corrupt_file"
  | "encrypted_file"
  | "empty_document"
  | "internal_error";

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
  }
}

/** The PDF has too little extractable text on average (likely image-only). */
export class ScannedPdfError extends ExtractionError {
  constructor() {
    super(
      "scanned_pdf",
      "The PDF has little or no extractable text; it looks scanned.",
    );
    this.name = "ScannedPdfError";
  }
}

/** More than the allowed number of pages (physical PDF pages or virtual text pages). */
export class TooManyPagesError extends ExtractionError {
  constructor(readonly maxPages: number) {
    super("too_many_pages", `The document has more than ${maxPages} pages.`);
    this.name = "TooManyPagesError";
  }
}

export class FileTooLargeError extends ExtractionError {
  constructor(readonly maxBytes: number) {
    super("file_too_large", "The file is too large.");
    this.name = "FileTooLargeError";
  }
}

/** The MIME type is not one of the supported types. */
export class UnsupportedMimeTypeError extends ExtractionError {
  constructor() {
    super("unsupported_type", "This file type is not supported.");
    this.name = "UnsupportedMimeTypeError";
  }
}

/**
 * The bytes do not match the claimed type: a PDF without a `%PDF-` header, or
 * "text" that is binary (contains NUL bytes) or is not valid UTF-8.
 */
export class InvalidFileSignatureError extends ExtractionError {
  constructor() {
    super("unsupported_type", "The file content does not match its file type.");
    this.name = "InvalidFileSignatureError";
  }
}

/** The PDF could not be parsed. */
export class CorruptPdfError extends ExtractionError {
  constructor() {
    super("corrupt_file", "The PDF could not be read.");
    this.name = "CorruptPdfError";
  }
}

/** The PDF needs a password to open. */
export class EncryptedPdfError extends ExtractionError {
  constructor() {
    super("encrypted_file", "The PDF is password-protected.");
    this.name = "EncryptedPdfError";
  }
}

/** Zero bytes, or a text file with no text once normalized. */
export class EmptyDocumentError extends ExtractionError {
  constructor() {
    super("empty_document", "The document is empty.");
    this.name = "EmptyDocumentError";
  }
}

/** A failure we did not anticipate. The original error is deliberately not kept. */
export class UnexpectedExtractionError extends ExtractionError {
  constructor() {
    super("internal_error", "Unexpected error while reading the document.");
    this.name = "UnexpectedExtractionError";
  }
}

import "server-only";

export { extractPages } from "./extract-pages";
export {
  CorruptPdfError,
  EmptyDocumentError,
  EncryptedPdfError,
  ExtractionError,
  FileTooLargeError,
  InvalidFileSignatureError,
  ScannedPdfError,
  TooManyPagesError,
  UnexpectedExtractionError,
  UnsupportedMimeTypeError,
} from "./errors";
export type { ExtractionErrorCode } from "./errors";
export { MAX_FILE_BYTES, MAX_PAGES, MIN_AVG_CHARS_PER_PAGE } from "./limits";

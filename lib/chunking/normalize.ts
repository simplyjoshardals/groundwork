/**
 * Canonical text normalization for Groundwork's ingestion pipeline.
 *
 * The output of `normalizePageText` is the ONLY text that chunk offsets
 * (`chunks.char_start` / `char_end`) and chunk content refer to. Never compute
 * an offset against the raw extracted text.
 *
 * Changing any rule below changes the offsets of already-ingested documents.
 * If you do, bump `PIPELINE_VERSION` so old documents can be found and
 * re-ingested (DATA_MODEL.md, `documents.pipeline_version`).
 *
 * This module is pure and has no `server-only` marker on purpose: the citation
 * viewer needs the same normalization on the client to match chunk text
 * against a rendered PDF text layer.
 */

/** Version of the normalization + chunking pipeline stored on each document. */
export const PIPELINE_VERSION = 1;

const ZWNJ = 0x200c;
const ZWJ = 0x200d;

/** Characters that start a new line (C0/C1 line controls and Unicode separators). */
function isLineBreakLike(code: number): boolean {
  return (
    code === 0x0b || // vertical tab
    code === 0x0c || // form feed
    code === 0x85 || // NEL
    code === 0x2028 || // line separator
    code === 0x2029 // paragraph separator
  );
}

/**
 * Invisible characters that carry no text content. U+200C (ZWNJ) and U+200D
 * (ZWJ) are deliberately NOT here: they are meaningful in Persian, Indic
 * scripts and emoji sequences (e.g. the family emoji). Variation selectors
 * (U+FE00-FE0F) are also kept for the same reason.
 */
function isRemovable(code: number): boolean {
  // C0 controls except tab (9), LF (10), VT (11), FF (12), CR (13); plus DEL.
  // NUL in particular cannot be stored in a Postgres text column.
  if (code <= 0x08 || (code >= 0x0e && code <= 0x1f) || code === 0x7f) {
    return true;
  }
  // C1 controls except NEL (0x85), which is treated as a line break.
  if (code >= 0x80 && code <= 0x9f && code !== 0x85) return true;
  switch (code) {
    case 0x00ad: // soft hyphen
    case 0x061c: // Arabic letter mark
    case 0x180e: // Mongolian vowel separator
    case 0x200b: // zero width space
    case 0x200e: // left-to-right mark
    case 0x200f: // right-to-left mark
    case 0xfeff: // BOM / zero width no-break space
      return true;
    default:
  }
  if (code >= 0x202a && code <= 0x202e) return true; // bidi embeddings/overrides
  if (code >= 0x2060 && code <= 0x2064) return true; // word joiner, invisible operators
  if (code >= 0x2066 && code <= 0x2069) return true; // bidi isolates
  if (code >= 0x206a && code <= 0x206f) return true; // deprecated format characters
  return false;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Removes invisible characters, turns line-break-like characters into "\n",
 * and replaces unpaired surrogates with U+FFFD (they are invalid in UTF-8 and
 * would be rejected by Postgres and JSON). This runs BEFORE NFKC so that
 * removing a character can never leave text that NFKC would still change.
 */
function cleanCodeUnits(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (isHighSurrogate(code)) {
      if (i + 1 < input.length && isLowSurrogate(input.charCodeAt(i + 1))) {
        out += input[i] + input[i + 1];
        i++;
      } else {
        out += "\uFFFD";
      }
      continue;
    }
    if (isLowSurrogate(code)) {
      out += "\uFFFD";
      continue;
    }
    if (isLineBreakLike(code)) {
      out += "\n";
      continue;
    }
    if (code === ZWNJ || code === ZWJ || !isRemovable(code)) {
      out += input[i];
    }
  }
  return out;
}

/**
 * Normalizes extracted page text into the canonical form used for offsets.
 *
 * Rules, in order:
 * 1. Drop invisible formatting characters (soft hyphen, ZWSP, BOM, bidi marks,
 *    control characters) but keep ZWJ/ZWNJ; map line separators to "\n";
 *    replace unpaired surrogates with U+FFFD.
 * 2. Unicode NFKC (ligatures like "ﬁ" become "fi", "e" + combining acute
 *    becomes "é", NBSP and other Unicode spaces become a plain space).
 * 3. CRLF and lone CR become "\n".
 * 4. Tabs, NBSP and any remaining Unicode space separators become " ".
 * 5. Runs of spaces collapse to one space; trailing spaces are stripped from
 *    every line.
 * 6. Three or more newlines collapse to exactly two (a paragraph break).
 * 7. The page is trimmed.
 *
 * Single newlines are preserved. The function is idempotent.
 */
export function normalizePageText(raw: string): string {
  return cleanCodeUnits(raw)
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ +(?=\n)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

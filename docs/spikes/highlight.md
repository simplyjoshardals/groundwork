# Spike 0.7: citation highlighting feasibility

**Status: feasible on the synthetic test set. Recommendation: build direct highlighting first, with page jump plus the passage panel as the mandatory fallback.** Single-column success was 5 of 5 (gate: about 40%). Two-column success was 3 of 5, and both misses are the known unrecoverable line-interleaved layout. Table success was 5 of 5. The numbers in sections 1 to 5 are **Claude's automated verification, run in headless Chromium 153 against a production build (`next build` then `next start`) on one machine**. Separately, the project owner tested the spike by hand in their own browser, in development and in production (`yarn build && yarn start`), and reported that highlighting appeared there too and that everything else worked, including inline error handling (section 5a; user-confirmed, with no scores or timings attached). The two sources are kept apart and are not combined. Neither was run on Vercel or on real-world PDFs; see section 7.

## Acceptance criteria (Task 0.7)

| Criterion                                                                    | Status           | Where / caveat                                                         |
| ---------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| Isolated client-only `react-pdf` page: load a PDF, jump to a page, highlight | Met              | `app/spike/highlight/` (section 2)                                     |
| About 5 passages on each of single-column, two-column and table              | Met              | Section 3                                                              |
| Whitespace, line breaks, hyphenation, ligatures                              | Met on 1 fixture | Section 4 (`highlight-edge`, 5 of 5; synthetic, one page)              |
| Success judged on the rendered highlight, not on extracted text              | Met              | Section 1: DOM check plus an independent pixel check                   |
| Verified with `next build` and `next start`, worker included                 | Met locally      | Sections 5 and 5a (user-confirmed). Not verified on Vercel             |
| Gate: single-column under ~40% means panel first                             | Not triggered    | 5 of 5, section 6. Small sample, so read it as "far above", not "100%" |

## How success is defined

| Tag                       | Meaning                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CORRECT**               | `<mark>` elements exist in the rendered text layer, every one is visible (non-zero size, inside the page, filled), and the text they cover equals the passage (normalised).                                                   |
| **WRONG**                 | Highlights exist but cover other text, or are not visible. Worse than nothing (BUILD_PLAN 3.5).                                                                                                                               |
| **NONE**                  | No highlight was drawn. The matcher declined (not found, ambiguous, or shorter than 12 key characters), so the fallback panel would apply.                                                                                    |
| **ERROR**                 | Timeout or the page canvas never rendered. None occurred.                                                                                                                                                                     |
| **PIXEL** (second check)  | Independent of the page's own verdict: in the screenshot, the share of yellow pixels inside each mark rectangle must exceed 30%, and the same rectangles in the pre-highlight screenshot must be below 2% (negative control). |
| **TEXT** (pre-check only) | The passage was found in PDF.js text items in Node. **Not a success measure**; it only shows what the matcher could possibly find.                                                                                            |

Tags used in the findings: **MEASURED** (observed in Claude's automated headless run), **USER-CONFIRMED** (reported by the project owner from manual testing; not measured or inspected by Claude), **DOC** (read from library source or docs), **INFER**, **OPEN**.

## 1. Results (MEASURED, Claude's automated run, headless Chromium 153, production build)

| Fixture                         | Passages | CORRECT | WRONG | NONE | ERROR | Success |
| ------------------------------- | -------- | ------- | ----- | ---- | ----- | ------- |
| single-column                   | 5        | 5       | 0     | 0    | 0     | 100%    |
| two-column                      | 5        | 3       | 0     | 2    | 0     | 60%     |
| table                           | 5        | 5       | 0     | 0    | 0     | 100%    |
| **Counted total**               | 15       | 13      | 0     | 2    | 0     | 87%     |
| highlight-edge (reported alone) | 5        | 5       | 0     | 0    | 0     | 100%    |

- **Pixel check:** 18 of 18 expected highlights confirmed (yellow inside the rectangles, none in the negative control); both NONE results showed no highlight colour anywhere on the page. Screenshots of `highlight-edge-1` and `two-column-3` were also looked at by eye.
- **Consistency:** the "Run all" button and a single "Highlight" click gave the same outcome for all 20 passages.
- **Text-level pre-check (TEXT, not success):** 18 of 20 passages are findable in PDF.js items in Node. The two that are not are `two-column-4` and `two-column-5`, the same two that came back NONE.
- **Wrong highlights: zero.** Every miss was a clean decline, never a mark in the wrong place. This comes from the unique-match rule (section 3).
- **The two misses** are pages 3 and 4 of `two-column.pdf`, where the two columns are written line by line interleaved. PDF.js returns each line as one fragment spanning both columns, so no passage exists as contiguous text. This is the same limit recorded in `docs/spikes/pdf.md`; it is a property of the file, not of the highlighter.
- **Latency (MEASURED, one fast machine):** a highlight on an already-rendered page took 3 to 17 ms; a jump to another page plus highlight took 34 to 72 ms in the final run (an earlier run on the previous build showed 320 to 370 ms for page changes, so treat 35 to 370 ms as the observed range, not a guarantee).

## 2. What was built

All temporary except where noted.

- `app/spike/highlight/{page,loader,viewer,observe}.tsx|ts`: the test page. `page.tsx` is a server wrapper; `loader.tsx` is a Client Component that loads `viewer.tsx` through `next/dynamic` with `ssr: false` (required to be in a Client Component). Delete `app/spike/` when done.
- `spikes/highlight/match.ts`: normalisation, matching and per-item range mapping, plus HTML escaping and `<mark>` rendering. Intended to be reused by Task 3.5, so move it into `lib/` then rather than deleting it.
- `spikes/highlight/outcome.ts`: the CORRECT/WRONG/NONE classifier.
- `spikes/highlight/passages.ts`: the 20 known passages, chosen by (page, item index) from the existing `*.expected.json` ground truth.
- `spikes/pdf/fixtures/highlight-edge.pdf` and `.expected.json`; `make_fixtures.py --only=highlight-edge` writes only these (the existing 20 fixture files were checked byte-identical by SHA-256).
- `tests/unit/spikes-highlight.test.ts`: matcher, rendering and classifier tests plus the Node-side text check. The suite is 59 tests, all passing.
- Fallback status in the spike: the page jump is implemented (choosing a page clears any highlight) and a declined match is reported as NONE. A passage panel is **not** built in the spike; it is the specified fallback and belongs to Task 3.6 (section 6).

## 3. How the highlight works

1. `react-pdf` renders the page and its text layer. `onGetTextSuccess` gives the PDF.js text items.
2. The matcher builds a key per page: lowercase, accent-stripped (NFKD), with whitespace, hyphens, dashes, soft hyphens and zero-width characters removed, and curly quotes straightened. Each key character remembers which item and offset it came from.
3. The passage is normalised the same way and searched in the page key. **Only a unique match counts.** Zero matches, several matches, or a key shorter than 12 characters all decline.
4. `customTextRenderer` receives `itemIndex` for every item and returns that item's HTML with the matched slice wrapped in `<mark data-hl="1" style="...">`. The text is HTML-escaped because the result is set as `innerHTML` (react-pdf sanitises blocked tags and `on*` attributes; `<mark>` and inline style survive).

Why whitespace and hyphen removal works (MEASURED): PDF.js already **folds ligatures to plain letters** in text content and does **not** dehyphenate, so a line-end hyphen stays as a character in the item text. Removing hyphens from both sides therefore matches "reim-" plus "bursement" to "reimbursement".

## 4. Edge cases (MEASURED, `highlight-edge.pdf`, 5 of 5)

One synthetic page with clean passages covering: ligature glyphs across lines, a compound hyphen at a line end, a broken-word hyphen, and curly quotes with en dashes. All five highlighted correctly and pixel-verified. This fixture is reported separately and **not counted** toward the 40% gate. It proves the normalisation rules on constructed cases, not on messy real documents.

## 5. Build, worker and error states (MEASURED, Claude's automated run, `next build` then `next start`)

| Item                 | Finding                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker configuration | `pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`, set at the top of the same module that renders `<Document>`/`<Page>`. Turbopack emitted `/_next/static/media/pdf.worker.min.<hash>.mjs`. |
| Worker actually used | The browser reported a dedicated worker at that URL, and the worker file was served with HTTP 200 on every request.                                                                                                                               |
| SSR                  | Server HTML contains only the loading placeholder; the viewer never runs on the server.                                                                                                                                                           |
| Text layer CSS       | `react-pdf/dist/Page/TextLayer.css` imported in the viewer; the text layer and highlights rendered correctly in the screenshots alongside the app's Tailwind setup.                                                                               |
| Page errors          | 0 uncaught page errors in the final run.                                                                                                                                                                                                          |
| Console              | Only `Warning: Indexing all PDF objects`, emitted by PDF.js when it recovers a damaged file (the two corrupt fixtures). Harmless.                                                                                                                 |
| Not a PDF / fake PDF | Rejected before loading: "That file is not a PDF (no %PDF- header)". An empty file and a file over 5 MB are also rejected in code; those two were not exercised in the browser.                                                                   |
| Corrupt (2 fixtures) | Inline message "Could not open this PDF: Invalid PDF structure." No page error.                                                                                                                                                                   |
| Password-protected   | Inline message "This PDF needs a password; the spike does not support encrypted files."                                                                                                                                                           |

### Bug found and fixed during the spike: Suspense mode

`react-pdf` 11 defaults to `suspense = true` on `Document` and `Page` (DOC, `useSuspenseResource.js`). In that mode a load failure is **thrown to the nearest error boundary**, so `onLoadError` and the `error` prop never produce an inline message. In Next this showed the full-screen "This page couldn't load" screen and an uncaught `InvalidPDFException` for both corrupt files. Setting `suspense={false}` on both components fixed it. After the fix the full measurement was re-run and all 20 outcomes were identical. **Task 3.2 must make an explicit choice here** (either `suspense={false}` or its own error boundary).

## 5a. User-confirmed manual verification (not measured by Claude)

The project owner tested the spike by hand in their own browser, in development and in production (`yarn build && yarn start`). Reported result: highlighting appeared in their browser too, and everything worked, including inline error handling. This is a first-hand report (USER-CONFIRMED). No fixture scores, timings, error cases or browser version are recorded for it here, and it is neither merged with nor counted in the automated measurements in sections 1 to 5.

## 6. Decision

The gate (single-column below about 40% means panel first) is **not triggered**: single-column was 5 of 5, table 5 of 5, two-column 3 of 5. Recommendation:

1. Build **direct highlighting** as the primary citation experience, using the approach in section 3.
2. Build **page jump plus passage panel** as the fallback, and show it whenever the matcher returns NONE-type results. This is not optional: line-interleaved layouts will always need it, and a wrong highlight is worse than none. The decline rules (unique match only, 12-character minimum) produced zero wrong highlights here and should be kept. In the spike only the page jump exists; the panel itself is Task 3.6 work.
3. Pin `react-pdf` 11.0.0 and `pdfjs-dist` 6.3.289 exactly.

Five passages per fixture is a small sample. "5 of 5" supports "clearly above the 40% gate", not "100% on real documents".

## 7. Limitations and open items

- **Synthetic fixtures (OPEN for real PDFs).** Standard fonts, clean encoding, no scanner artefacts. Real PDFs (odd encodings, hyphenation variants, headers and footers repeated on every page, multi-fragment words) may do worse, and the real match target is chunk text produced by the ingest pipeline, not hand-picked ground truth.
- **Version split.** Chunk text comes from `unpdf` 1.9.1 (PDF.js 6.4.299, server) while highlighting runs on `pdfjs-dist` 6.3.289 (client). They agreed on all 18 findable passages here, but a text difference between versions would show up as NONE, not as a wrong highlight. Consider aligning the two.
- **Limited browser coverage.** Claude's automated run used one machine: headless Chromium 153 on Linux at device pixel ratio 1. The owner's manual run used their own browser, which this report does not identify. Safari, Firefox, mobile, high-DPI screens, zoom and window resize were not covered by the automated run, so cross-browser coverage is unknown.
- **Not run on Vercel.** The production build and worker were verified with `next start` locally. A deployed check is still advisable before relying on the worker path.
- **Index mapping is tied to react-pdf internals.** Highlights rely on `customTextRenderer`'s `itemIndex` lining up with `textContent.items` (and with end-of-line elements). A `react-pdf` upgrade could change that; the pin and the 20-passage run are the regression check.
- **Not tested:** passages that cross a page break; two passages on one page highlighted together; text selection or search over highlighted text; scanned PDFs (no text layer, so always the fallback); repeated header and footer text that makes a short passage ambiguous (declined by design); very large pages.
- **Interleaved two-column pages are unrecoverable** by this method (2 of 2 NONE), consistent with `docs/spikes/pdf.md`.
- **Build-plan status:** the Task 0.7 criteria and the "After 0.7" decision gate are ticked in `BUILD_PLAN.md`, based on this report (Claude's automated run) plus the user-confirmed manual run in section 5a. The decision is recorded in `docs/decisions.md`.

## 8. Run it yourself

```bash
yarn add --exact react-pdf@11.0.0 pdfjs-dist@6.3.289   # updates yarn.lock
yarn dev                                               # open /spike/highlight
yarn build && yarn start                               # repeat on the production build
```

Choose a file from `spikes/pdf/fixtures/` (the page recognises `single-column`, `two-column`, `table` and `highlight-edge` by name), press **Run all**, and read the results table. Choosing a different passage and **Highlight** runs one case; "custom passage" accepts your own text. Cleanup when finished: delete `app/spike/`.

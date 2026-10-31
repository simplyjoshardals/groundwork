# Spike 0.6: PDF text extraction on Vercel

**Status: IN PROGRESS. Task 0.6 is NOT complete.** Everything below tagged **LOCAL** was run on a development machine with Node 22, not on Vercel. The Vercel measurements the task requires (cold start, 30-page duration, the deployed behaviour of every test file) are **NOT RUN YET** (section 6). Do not tick Task 0.6 until section 6 is filled in from real deployed runs.

## How to read this document

| Tag        | Meaning                                                                               |
| ---------- | ------------------------------------------------------------------------------------- |
| **LOCAL**  | Executed on a development machine (Node 22). Proves the code and library, not Vercel. |
| **VERCEL** | Executed against the deployed route. Result files reviewed. **None yet.**             |
| **DOC**    | Read from package metadata or documentation. Not confirmed by a request.              |
| **INFER**  | Inference from the numbers. Consistent with the evidence, not proven.                 |
| **OPEN**   | Unknown.                                                                              |

## 1. Library choice

| Item                       | Finding                                                                                                                                                                                                                                                  | Tag                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Library                    | `unpdf`, pinned exactly to **1.9.1** (`yarn add --exact unpdf@1.9.1`)                                                                                                                                                                                    | decision                              |
| What it is                 | Serverless-oriented build of PDF.js. No native dependencies. Bundled PDF.js version: **6.4.299**                                                                                                                                                         | LOCAL (read from the running library) |
| Why not the latest (2.1.0) | npm metadata for 2.0.0 and 2.1.0 says `engines.node >= 24`. This project runs Node 22 (CI is pinned to 22, `@types/node` is `^22`). 1.9.1 declares `engines.node >= 22`. Moving the project to Node 24 is a separate decision and not part of this task. | DOC (npm metadata, read 2026-10-31)   |
| Release dates              | 1.9.1: 2026-10-19. 2.0.0: 2026-10-28. 2.1.0: 2026-10-30                                                                                                                                                                                                  | DOC                                   |
| `@napi-rs/canvas`          | Listed as an optional peer dependency (rendering only). Not installed and not needed: text extraction worked without it                                                                                                                                  | LOCAL                                 |
| Alternatives not tried     | `pdf-parse`, `pdfjs-dist` directly (task says to try one extractor)                                                                                                                                                                                      | n/a                                   |

The Node 22 versus 2.x constraint is the main finding from choosing the library. Revisit it if the project moves to Node 24.

## 2. What was built

- `spikes/pdf/extract.ts`: extraction with typed, controlled errors (`not_pdf`, `too_large`, `too_many_pages`, `encrypted`, `corrupt`, `unexpected`). Library messages are never forwarded.
- `app/api/spike-pdf/route.ts`: **temporary**, token-protected route (same rules as `/api/spike`). Raw PDF body, size cap, `text=none|full` query. Reports cold-start information.
- `spikes/pdf/run.ts`: CLI for local and deployed runs; scores against ground truth; saves results to `spikes/pdf/results/` (git-ignored).
- `spikes/pdf/make_fixtures.py`, `spikes/pdf/fixtures/`: the synthetic test PDFs and ground-truth files (committed, 716 KB in total).
- `tests/unit/spikes-pdf.test.ts`: unit tests, including every fixture.

A bug found and fixed while building: pdf.js 6.x has no `destroy()` on the document proxy (it lives on `loadingTask`). The first version called it inside `finally`, so a raw `TypeError` escaped the error mapping on every valid PDF. Cleanup is now a separate function that cannot throw.

## 3. Test files

All fixtures are **synthetic** (a fictional company). They are cleaner than real-world PDFs (standard fonts, no odd encodings, no scanner artefacts), so the results are a **baseline, not a guarantee**. Real PDFs may do worse.

| File                          | What it is                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `single-column.pdf`           | 10 pages, one column of prose                                                                                                         |
| `two-column.pdf`              | 4 pages. Pages 1-2 write each column in turn; pages 3-4 write the two columns **line by line, interleaved** (a common export pattern) |
| `table.pdf`                   | 3 pages, each a bordered table (header + 14 rows, 5 columns)                                                                          |
| `scanned.pdf`                 | 3 pages, image only, no text                                                                                                          |
| `scanned-with-footer.pdf`     | Same, plus a real-text "Page N" stamped on each page                                                                                  |
| `encrypted-user-password.pdf` | `single-column.pdf` encrypted (AES-256), user password required                                                                       |
| `encrypted-owner-only.pdf`    | Same, owner password only (opens without a password, printing restricted)                                                             |
| `corrupt-truncated.pdf`       | `single-column.pdf` cut at 55%                                                                                                        |
| `corrupt-garbage.pdf`         | `%PDF-1.7` header followed by random bytes                                                                                            |
| `fake-exe.pdf`                | Random bytes starting `MZ` (an executable renamed `.pdf`)                                                                             |
| `thirty-pages.pdf`            | 30 dense text pages, for timing                                                                                                       |
| `sparse-text.pdf`             | 6 slide-like pages with a few short lines each (a threshold probe)                                                                    |

The task lists five cases; the others are extras: the two scanned and two encrypted variants, the corrupt and fake files the acceptance criteria need, the 30-page timing file, and the sparse probe.

## 4. Extraction quality (LOCAL, Node 22.23.4)

Scoring (`spikes/pdf/score.ts`): each page has a list of known source fragments in reading order. **Recall** is the share found in the extracted page text; **in order** says the found fragments appear in reading order. Case, whitespace and soft hyphens are ignored. Where nothing is found on a page, "in order" is vacuously true and means nothing.

| File                      | Pages | Found / expected, per page   | Characters per page (non-whitespace) |
| ------------------------- | ----: | ---------------------------- | ------------------------------------ |
| `single-column.pdf`       |    10 | 8/8 on every page            | 933-964 (avg 949.5)                  |
| `two-column.pdf`          |     4 | **14/14, 14/14, 0/14, 0/14** | 1,648-1,674 (avg 1,657.8)            |
| `table.pdf`               |     3 | 15/15 on every page          | 594-615 (avg 604.3)                  |
| `thirty-pages.pdf`        |    30 | 16/16 on every page          | 1,870-1,928 (avg 1,889.5)            |
| `sparse-text.pdf`         |     6 | 3/3 on every page            | 59 on every page                     |
| `scanned.pdf`             |     3 | no text expected             | 0 on every page                      |
| `scanned-with-footer.pdf` |     3 | no text expected             | 5 on every page                      |

Findings:

- **Single column and table:** perfect on these synthetic files. Table rows come out as single lines of cells in order, which is the easy case (cells written row by row). A table whose cells are written column by column, or with merged cells, was **not** tested.
- **Two column, column-ordered pages:** perfect.
- **Two column, line-interleaved pages: 0 of 14 fragments found.** The extractor returns text in content-stream order, so the two columns' lines are merged into one line of mixed text. Text is present but the sentences are not recoverable. A real two-column PDF may be written either way and **which one is common was not measured**. This matters for retrieval quality and for highlighting (task 0.7), because chunks built from interleaved text are mixed-up sentences.
- **Encrypted, owner password only:** extracts normally (recall 1, same as the unencrypted original). Only a PDF that needs a user password is rejected.

## 5. Scanned-PDF threshold and errors

### 5.1 Threshold (LOCAL)

The heuristic is the one in ARCHITECTURE section 3.6: **average non-whitespace characters per page below a threshold means scanned.**

| File                      | Average characters per page | Should be flagged?                |
| ------------------------- | --------------------------: | --------------------------------- |
| `scanned.pdf`             |                           0 | yes                               |
| `scanned-with-footer.pdf` |                           5 | yes                               |
| `sparse-text.pdf`         |                          59 | no (real text, very little of it) |
| `table.pdf`               |                       604.3 | no                                |
| `single-column.pdf`       |                       949.5 | no                                |
| `two-column.pdf`          |                     1,657.8 | no                                |
| `thirty-pages.pdf`        |                     1,889.5 | no                                |

- **Provisional threshold: 25.** It sits between the highest scanned file (5) and the lowest text file (59): a factor of 5 above the scans and 2.4 below the sparse text.
- With 25, every scanned fixture is flagged and no text fixture is flagged (unit-tested in `tests/unit/spikes-pdf.test.ts`).
- My first guess, 100, wrongly flagged `sparse-text.pdf` (59). The data corrected it.
- **Limits of this evidence:** two scanned files, both generated here by one method. A real scan with a longer stamp (for example a Bates number of 35+ characters per page) would average above 25 and be treated as text. A real text PDF of mostly images and captions could fall below 25 and be flagged. **The threshold is validated against synthetic data only.** It must be checked against real scans before it is relied on (task 1.5).
- Using the average means one blank page in a long document does not flag it (unit-tested).

### 5.2 Errors (LOCAL, through a production build and the route over HTTP)

| Input                                                           | Result                                                 | HTTP | Controlled? |
| --------------------------------------------------------------- | ------------------------------------------------------ | ---: | ----------- |
| `encrypted-user-password.pdf`                                   | `encrypted`                                            |  422 | yes         |
| `corrupt-truncated.pdf`                                         | `corrupt`                                              |  422 | yes         |
| `corrupt-garbage.pdf`                                           | `corrupt`                                              |  422 | yes         |
| `fake-exe.pdf`                                                  | `not_pdf` (rejected by magic bytes before PDF.js runs) |  415 | yes         |
| missing or wrong `x-spike-token`                                | Unauthorized                                           |  401 | yes         |
| wrong `Content-Type`, bad `text` value, empty body, 4.5 MB body | 415, 400, 400, 413                                     |      | yes         |

No unexpected-error log lines appeared in the server log during these runs. **This is not yet shown on Vercel.**

## 6. Vercel measurements: NOT RUN YET

Required by Task 0.6 and still to do (see the runbook given with this change):

- [ ] Every fixture through the deployed route: status, page count, scanned flag, scores. Compare with section 4 and 5.
- [ ] **Cold start**: first request after at least 10 to 15 minutes idle: `instance.coldStart`, `importMs`, `serverMs`, round trip. Repeat to get more than one sample.
- [ ] **Warm duration** for `thirty-pages.pdf`: at least 3 consecutive runs; `timings.loadMs` and `extractMs`.
- [ ] Confirm the deployed Node version and region (`instance.node`, `instance.region`, `x-vercel-id`).
- [ ] Confirm the encrypted and corrupt files return controlled errors on Vercel and that nothing crashes the function (check Vercel logs for unhandled errors).
- [ ] Record `maxDuration` that actually applied and the real request-body limit (the code assumes about 4.4 MB; the plan says to verify).

For reference only, **LOCAL** timings for `thirty-pages.pdf` on a development machine: load about 71 ms, extract about 120 ms. These say nothing about Vercel, whose CPU and cold start are different.

## 7. Limitations and open questions

- All fixtures are synthetic; real PDFs will be messier (section 3).
- Line-interleaved two-column text is not recoverable by this extractor (section 4). No alternative extractor was tried.
- The threshold rests on two synthetic scans (section 5.1).
- Owner-password-only PDFs are accepted. Whether to reject them anyway is a product decision for task 1.5.
- Whether the Vercel build needs `serverExternalPackages` for `unpdf` is **unknown** until it is deployed. A production build and server run locally worked without it (LOCAL).
- A local `next build` here needed the Google Fonts import removed because the build machine could not reach Google; the project's own build is unchanged.
- Cold start can only be sampled; Vercel may reuse instances (Fluid compute), so a "cold" sample depends on idle time (INFER).

## 8. Cleanup when the spike is finished

- Delete `app/api/spike-pdf/route.ts`; rotate or remove `SPIKE_TOKEN` if nothing else uses it.
- Keep `spikes/pdf/extract.ts` and the fixtures until task 1.5 turns them into `lib/pdf/`, then move or delete `/spikes` (task 6.9).
- Do not commit `spikes/pdf/results/`.

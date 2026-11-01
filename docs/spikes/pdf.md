# Spike 0.6: PDF text extraction on Vercel

**Status: the Task 0.6 acceptance criteria are met on the synthetic test set, with the caveats in section 7.** Local results (Node 22.23.4) are in sections 4 and 5. Deployed results (Vercel function on Node v26.13.0, region `iad1`, valid runs 2026-11-01 12:35 to 13:01 UTC) are in section 6 and tagged **VERCEL**. Two measurements are thinner than they may sound: there is **one** cold-start sample (on the 10-page file, not the 30-page one), and the three 30-page runs were all warm.

## Acceptance criteria (Task 0.6)

| Criterion                                                                                           | Status                        | Where / caveat                                                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Library and version, per-page quality on each PDF, Vercel runtime (cold start and 30-page duration) | Met, with caveats             | Sections 1, 4, 6.2 to 6.4. One cold sample, taken on the 10-page file. The 30-page runs were warm only. |
| Characters-per-page threshold flags the scanned PDF and not the text PDFs                           | Met on the synthetic test set | Section 5.1. Not validated on real scans.                                                               |
| Encrypted and corrupt files give a catchable error, not a crash                                     | Met                           | Section 5.2. Vercel runtime logs were not reviewed.                                                     |

## How to read this document

| Tag        | Meaning                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LOCAL**  | Executed on a development machine (Node 22). Proves the code and library, not Vercel.                                                                 |
| **VERCEL** | Executed against the deployed route (Vercel function, Node v26.13.0). Result files reviewed (a ZIP of 16 CLI result files, 2026-10-31 to 2026-11-01). |
| **DOC**    | Read from package metadata or documentation. Not confirmed by a request.                                                                              |
| **INFER**  | Inference from the numbers. Consistent with the evidence, not proven.                                                                                 |
| **OPEN**   | Unknown.                                                                                                                                              |

## 1. Library choice

| Item                       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tag                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Library                    | `unpdf`, pinned exactly to **1.9.1** (`yarn add --exact unpdf@1.9.1`)                                                                                                                                                                                                                                                                                                                                                                                         | decision                                                      |
| What it is                 | Serverless-oriented build of PDF.js. No native dependencies. Bundled PDF.js version: **6.4.299**                                                                                                                                                                                                                                                                                                                                                              | LOCAL (read from the running library)                         |
| Why not the latest (2.1.0) | npm metadata for 2.0.0 and 2.1.0 says `engines.node >= 24`. This project's CI and local setup use Node 22 (CI is pinned to 22, `@types/node` is `^22`). 1.9.1 declares `engines.node >= 22`. The deployed function reported Node v26.13.0 (section 6.1), so the engines field would not block 2.x on Vercel, but 2.x was not tried and CI and local stay on Node 22. Moving the project to Node 24 or later is a separate decision and not part of this task. | DOC (npm metadata, read 2026-10-31), VERCEL (runtime version) |
| Release dates              | 1.9.1: 2026-10-19. 2.0.0: 2026-10-28. 2.1.0: 2026-10-30                                                                                                                                                                                                                                                                                                                                                                                                       | DOC                                                           |
| `@napi-rs/canvas`          | Listed as an optional peer dependency (rendering only). Not installed and not needed: text extraction worked without it, locally and on Vercel                                                                                                                                                                                                                                                                                                                | LOCAL, VERCEL                                                 |
| Where it ran on Vercel     | Node v26.13.0 (`process.version` reported by the route in all 15 valid runs), region `iad1` (`VERCEL_REGION`)                                                                                                                                                                                                                                                                                                                                                 | VERCEL                                                        |
| Alternatives not tried     | `pdf-parse`, `pdfjs-dist` directly (task says to try one extractor)                                                                                                                                                                                                                                                                                                                                                                                           | n/a                                                           |

The Node 22 versus 2.x constraint is the main finding from choosing the library. Revisit it if the project moves to Node 24. Note that the deployed runtime (Node 26.13.0) differs from CI and local (Node 22); see section 7.

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

## 4. Extraction quality (LOCAL Node 22.23.4; the same files were re-run on VERCEL, section 6.2)

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

**On Vercel every number in this table was identical:** same page counts, same found/expected per page, same characters per page (min, max and average) on every file (section 6.2).

Findings:

- **Single column and table:** perfect on these synthetic files, locally and on Vercel. Table rows come out as single lines of cells in order, which is the easy case (cells written row by row). The deployed preview of table page 1 reads `Action register, part 1 Item Owner Due date Budget Status Help Desk 100 Marcus 25 Jan 2027 1464.89 Done …`: cells are joined by single spaces, so column and row boundaries are **not marked** in the text. A table whose cells are written column by column, or with merged cells, was **not** tested.
- **Two column, column-ordered pages:** perfect.
- **Two column, line-interleaved pages: 0 of 14 fragments found (locally and on Vercel).** The extractor returns text in content-stream order, so the two columns' lines are merged into one line of mixed text. Text is present but the sentences are not recoverable. The deployed previews show it: page 3 starts `Brindlemoor note 504.1: the provisional lost Brindlemoor note 505.1: the …`, i.e. two different sentences cut together. A real two-column PDF may be written either way and **which one is common was not measured**. This matters for retrieval quality and for highlighting (task 0.7), because chunks built from interleaved text are mixed-up sentences.
- **Encrypted, owner password only:** extracts normally (recall 1, same as the unencrypted original), locally and on Vercel. Only a PDF that needs a user password is rejected.

## 5. Scanned-PDF threshold and errors

### 5.1 Threshold (LOCAL and VERCEL)

The heuristic is the one in ARCHITECTURE section 3.6: **average non-whitespace characters per page below a threshold means scanned.**

| File                       | Average characters per page | Should be flagged?                | Flagged on Vercel? |
| -------------------------- | --------------------------: | --------------------------------- | ------------------ |
| `scanned.pdf`              |                           0 | yes                               | yes                |
| `scanned-with-footer.pdf`  |                           5 | yes                               | yes                |
| `sparse-text.pdf`          |                          59 | no (real text, very little of it) | no                 |
| `table.pdf`                |                       604.3 | no                                | no                 |
| `single-column.pdf`        |                       949.5 | no                                | no (both runs)     |
| `two-column.pdf`           |                     1,657.8 | no                                | no                 |
| `thirty-pages.pdf`         |                     1,889.5 | no                                | no (all 3 runs)    |
| `encrypted-owner-only.pdf` |                       949.5 | no                                | no                 |

- **Threshold: 25** average non-whitespace characters per page (below 25 means scanned). It sits between the highest scanned file (5) and the lowest text file (59): a factor of 5 above the scans and 2.4 below the sparse text.
- With 25, every scanned fixture is flagged and no text fixture is flagged, locally (unit-tested in `tests/unit/spikes-pdf.test.ts`) and on Vercel: of the 11 deployed runs that extracted text, both scanned runs were flagged and all 9 text runs were not (VERCEL). The deployed route does not report the threshold it used; the flags are consistent with the default of 25.
- My first guess, 100, wrongly flagged `sparse-text.pdf` (59). The data corrected it.
- **Limits of this evidence:** two scanned files, both generated here by one method. A real scan with a longer stamp (for example a Bates number of 35+ characters per page) would average above 25 and be treated as text. A real text PDF of mostly images and captions could fall below 25 and be flagged. **The threshold is validated against synthetic data only.** It must be checked against real scans before it is relied on (task 1.5).
- Using the average means one blank page in a long document does not flag it (unit-tested).

### 5.2 Errors (LOCAL table, then VERCEL table)

| Input                                                           | Result                                                 | HTTP | Controlled? |
| --------------------------------------------------------------- | ------------------------------------------------------ | ---: | ----------- |
| `encrypted-user-password.pdf`                                   | `encrypted`                                            |  422 | yes         |
| `corrupt-truncated.pdf`                                         | `corrupt`                                              |  422 | yes         |
| `corrupt-garbage.pdf`                                           | `corrupt`                                              |  422 | yes         |
| `fake-exe.pdf`                                                  | `not_pdf` (rejected by magic bytes before PDF.js runs) |  415 | yes         |
| missing or wrong `x-spike-token`                                | Unauthorized                                           |  401 | yes         |
| wrong `Content-Type`, bad `text` value, empty body, 4.5 MB body | 415, 400, 400, 413                                     |      | yes         |

No unexpected-error log lines appeared in the local server log during these runs.

**VERCEL (2026-11-01, Node v26.13.0).** Every response was `application/json` with a stable error code and no library message:

| Input                         | Result      | HTTP | Server ms | Instance invocation |
| ----------------------------- | ----------- | ---: | --------: | ------------------- |
| `encrypted-user-password.pdf` | `encrypted` |  422 |      53.2 | 16                  |
| `corrupt-truncated.pdf`       | `corrupt`   |  422 |       2.9 | 17                  |
| `corrupt-garbage.pdf`         | `corrupt`   |  422 |       4.2 | 2 (new instance)    |
| `fake-exe.pdf`                | `not_pdf`   |  415 |       4.9 | 3                   |

**No crash:** the instance kept serving after the errors. After the first two, the same instance (uptime still counting: 1,069,772, 1,090,671, then 1,123,149 ms) handled the three 30-page runs (invocations 18 to 20). After the last two, the same new instance (invocation 4) extracted `encrypted-owner-only.pdf` successfully. **Not verified:** Vercel runtime logs were not provided, so the absence of unhandled errors in the logs is unchecked. The validation paths (401 wrong token, 415 wrong `Content-Type`, 400 bad parameter or empty body, 413 oversized) were tested locally only.

## 6. Vercel results (VERCEL)

Source: a ZIP of 16 CLI result files (client machine on Node v22.18.0), 2026-10-31 22:01 to 2026-11-01 13:01 UTC. Each file holds what the route returned (status, content type, `x-vercel-id`, timings, instance info, per-page character counts, scores). **13 files (15 runs) are valid results; 3 early attempts failed (6.6).** The raw files are not committed.

### 6.1 Environment

| Item             | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Function runtime | Node v26.13.0 (`instance.node`, all 15 valid runs)                             |
| Function region  | `iad1` (`instance.region`); entry point `fra1` in `x-vercel-id: fra1::iad1::…` |
| Dependencies     | `unpdf` 1.9.1 bundled and ran; no `@napi-rs/canvas`                            |

### 6.2 Per-file results (valid runs, all 12 fixtures were run)

| File                              | Pages | Result | Avg chars/page | Flagged scanned | Found / expected per page       |             Server ms |
| --------------------------------- | ----: | ------ | -------------: | --------------- | ------------------------------- | --------------------: |
| `single-column.pdf` (warm, 12:35) |    10 | 200 ok |          949.5 | no              | 8/8 on every page               |                  41.3 |
| `single-column.pdf` (cold, 12:59) |    10 | 200 ok |          949.5 | no              | 8/8 on every page               |                 316.3 |
| `two-column.pdf`                  |     4 | 200 ok |        1,657.8 | no              | 14/14, 14/14, **0/14, 0/14**    |                  19.9 |
| `table.pdf`                       |     3 | 200 ok |          604.3 | no              | 15/15 on every page             |                  13.4 |
| `scanned.pdf`                     |     3 | 200 ok |              0 | **yes**         | no text expected                |                   7.1 |
| `scanned-with-footer.pdf`         |     3 | 200 ok |              5 | **yes**         | no text expected                |                   6.4 |
| `sparse-text.pdf`                 |     6 | 200 ok |             59 | no              | 3/3 on every page               |                  18.5 |
| `encrypted-owner-only.pdf`        |    10 | 200 ok |          949.5 | no              | 8/8 on every page               |                 272.7 |
| `thirty-pages.pdf` (3 runs)       |    30 | 200 ok |        1,889.5 | no              | 16/16 on every page, all 3 runs | 133.8 / 186.8 / 101.3 |

The four error files are in section 5.2. Characters per page (min to max) matched the local run exactly: single-column 933 to 964, two-column 1,648 to 1,674, table 594 to 615, thirty-pages 1,870 to 1,928. `encrypted-owner-only.pdf` spent 222.6 ms in PDF.js load on a warm instance (the other warm files took 0.9 to 2.8 ms); the cause was not investigated (INFER: first use of the AES-256 decryption path on that instance).

### 6.3 Cold start (one sample)

| Measure                         |                                                                          Cold |                                 Same file, warm |
| ------------------------------- | ----------------------------------------------------------------------------: | ----------------------------------------------: |
| Request                         | `single-column.pdf`, 2026-11-01 12:59:18 UTC, `coldStart: true`, invocation 1 | 12:35:31 UTC, `coldStart: false`, invocation 10 |
| Route handler time (`serverMs`) |                                                                      316.3 ms |                                         41.3 ms |
| Module import (`importMs`)      |                                                                        3.5 ms |                                               0 |
| PDF.js load (`loadMs`)          |                                                                      203.4 ms |                                          2.3 ms |
| Extraction (`extractMs`)        |                                                                       95.0 ms |                                         38.1 ms |
| Client round trip               |                                                                    2,427.0 ms |                                      1,278.8 ms |

- Server side, the cold request took about 275 ms longer than the same file warm, almost all of it PDF.js initialisation (load 203.4 versus 2.3 ms). The remaining ~14 ms of the cold `serverMs` is request handling (INFER).
- The client round-trip gap (about 1.1 s) is **noisy evidence**: warm round trips for files under 40 KB ranged from 589.0 to 1,278.8 ms in this data.
- **Not observable:** platform start-up before the route module loaded. `instanceUptimeMs` starts at module load (320 ms here, about the same as `serverMs`).
- The previous request in the result files was about 19 minutes earlier (12:40:09 UTC); other traffic to the route is not visible, so the idle time is a lower-bound estimate.
- **Sample size is 1.** The earlier checklist asked to repeat for more than one sample; that was not done. The cold request used the 10-page file; **a cold 30-page run was not measured.**

### 6.4 30-page duration (three runs, all warm)

`thirty-pages.pdf`: 30 pages, 37,752 bytes, 1,889.5 average characters per page, recall 1, not flagged. All three runs had `coldStart: false` (invocations 18 to 20 on one instance, uptime about 1,123 s).

| Run | Server ms | PDF.js load ms | Extraction ms | Client round trip ms |
| --- | --------: | -------------: | ------------: | -------------------: |
| 1   |     133.8 |            2.1 |         130.8 |              1,270.9 |
| 2   |     186.8 |            2.8 |         182.9 |                589.0 |
| 3   |     101.3 |            1.5 |          98.7 |                593.3 |

Extraction took 98.7 to 182.9 ms (about 3.3 to 6.1 ms per page); mean server time 140.6 ms. The one local run on a Node 22 development machine (extraction about 120 ms) is inside that range. The first run's slower round trip is probably connection set-up (INFER, not tested).

### 6.5 What the runs say about the plan's risk

Extraction of a 30-page dense text PDF is well inside any serverless limit in these runs (longest valid server time 316.3 ms, the cold single-column request). Whether the route's `maxDuration` of 60 s was applied by Vercel was not tested.

### 6.6 Failed early attempts (excluded from every table)

| Started (UTC)       | HTTP | Content type               | `x-vercel-id`   |
| ------------------- | ---: | -------------------------- | --------------- |
| 2026-10-31 22:01:19 |  404 | `text/html; charset=utf-8` | `fra1::vs2zw-…` |
| 2026-10-31 22:04:36 |  200 | `text/html; charset=utf-8` | `fra1::mrwnw-…` |
| 2026-11-01 08:51:09 |  200 | `text/html; charset=utf-8` | `fra1::gwzkc-…` |

None returned JSON, so each was recorded as `ok: false` with no page data. The CLI saved only the status, content type and `x-vercel-id`, not the body, the redirect chain or the URL, so **the cause is not established by these files.** One observation: all three carry a two-part `x-vercel-id` (`fra1::<id>`) while every valid run carries a three-part one (`fra1::iad1::<id>`). Under the layout assumption already used in `docs/spikes/provider.md` (`edge::function::id`, not verified here), that suggests the early requests were answered without invoking the function (INFER). The 404 would fit a route not yet deployed at that URL (INFER). What changed between 08:51 and 12:35 is not recorded.

### 6.7 Not tested on Vercel

- `maxDuration` as applied by Vercel, and the real request-body limit (the largest upload was 231,334 bytes; the route's cap of about 4.4 MB is untested).
- The validation paths: 401, 415, 400, 413 (local only).
- A cold 30-page run, a second cold sample, and the cold behaviour of the encrypted path.
- Vercel runtime logs (not provided).
- Any real-world PDF (all fixtures are synthetic).

## 7. Limitations and open questions

- All fixtures are synthetic; real PDFs will be messier (section 3).
- Line-interleaved two-column text is not recoverable by this extractor (sections 4 and 6.2, confirmed on Vercel). No alternative extractor was tried.
- The threshold rests on two synthetic scans and one sparse-text probe, validated locally and on Vercel (section 5.1). Real scans are untested.
- Owner-password-only PDFs are accepted (locally and on Vercel). Whether to reject them anyway is a product decision for task 1.5.
- Bundling worked on Vercel: the deployed route loaded `unpdf` and extracted text. I have not seen the deployed `next.config.ts`; the copy of the repo I hold contains no `serverExternalPackages`.
- **Runtime mismatch:** Vercel ran Node v26.13.0 while CI and local use Node 22, so CI does not test the Node version production runs. The extraction output was identical on both. The `package.json` in the copy I hold has no `engines` field; the project's Vercel Node setting was not checked.
- **Cold start:** one sample, on a 10-page file; platform start-up before the module loaded is not observable (section 6.3). Vercel may reuse instances (Fluid compute), so a "cold" sample depends on idle time (INFER).
- **Known CLI gap:** `spikes/pdf/run.ts` follows redirects silently, swallows a non-JSON response, and records neither the redirect chain nor the body (section 6.6). It also forwards `x-spike-token` on a redirect to another origin (reproduced locally). Not changed in this documentation-only step.
- A local `next build` here needed the Google Fonts import removed because the build machine could not reach Google; the project's own build is unchanged.

## 8. Cleanup when the spike is finished

- Delete `app/api/spike-pdf/route.ts`; rotate or remove `SPIKE_TOKEN` if nothing else uses it.
- Keep `spikes/pdf/extract.ts` and the fixtures until task 1.5 turns them into `lib/pdf/`, then move or delete `/spikes` (task 6.9).
- The route stays deployed and token-protected until deleted; rotate `SPIKE_TOKEN` when it is removed.
- Do not commit `spikes/pdf/results/`.

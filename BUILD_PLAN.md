# Document Q&A: Build Plan

Companion to `REQUIREMENTS.md`, `ARCHITECTURE.md`, and `DATA_MODEL.md`. Tick boxes as you go. Section references like "DATA_MODEL §2.3" point to those files so nothing is duplicated here.

**Your profile, as I'm planning for it:** comfortable with Next.js, TypeScript, Tailwind, and Supabase basics. Likely new or shaky: pgvector and RAG retrieval, SSE streaming through Vercel, PDF.js text layers, deep RLS and column-level grants, storage policies, anonymous auth, and Playwright. The plan puts the unfamiliar things **first** and the familiar CRUD and UI work **later**.

---

## How to Use This Plan

- [ ] Create a `docs/decisions.md` file. Every time a spike or gate changes the design, add one dated line. It becomes README material later.
- [ ] One git branch per slice (`slice-1-ask-sample`), merged to `main` only when the slice passes the Definition of Done (section 4). Tag each merge `slice-N`.
- [ ] **Timebox rule:** if a task passes **2× its estimate**, stop. Split it, cut it, or write down what's blocking you. Don't grind silently.
- [ ] **Spike rule:** spikes are throwaway code under `/spikes`. Their only output is a written finding in `docs/spikes/`.
- [ ] **Visibility rule:** the deployed URL stays private (don't put it on your CV or social media) until **Milestone M5**. Before that, limits and CAPTCHA aren't in place.
- [ ] **Migration naming:** `supabase migration new <name>` creates timestamped files, and the order they're applied is timestamp order. The `0005`-`0008` numbers in `DATA_MODEL.md` are labels only. In this plan, `0006` lands in Slice 4, `0007` in Slice 3, and `0005`/`0008` in Slice 5. None of them depend on each other out of order.
- [ ] **Slice 0 is the one deliberate exception** to "every slice is usable end to end". It is risk reduction: its deliverables are decisions, spike findings, and a deployed skeleton.

### Progress tracker

- [x] **Slice 0:** Foundations and de-risking spikes (~20 h)
- [ ] **Slice 1:** Ask the sample documents (walking skeleton) (~28 h)
- [ ] **Slice 2:** Honest answers and the eval (~18 h)
- [ ] **Slice 3:** Verify a citation: PDF viewer with highlight (~17 h)
- [ ] **Slice 4:** Your own documents: sign-up, upload, ingest, delete (~26 h)
- [ ] **Slice 5:** Public-ready: limits, CAPTCHA, fallback, hardening (~24 h)
- [ ] **Slice 6:** Ship: accessibility, polish, README, demo (~23 h)

---

## 1. Vertical Slices (what each one delivers)

| Slice | A user can now...                                                                                                                                                         | Layers touched                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **0** | (nothing yet) You know provider access works from Nigeria, PDF extraction runs on Vercel, streaming isn't buffered, and highlighting is feasible. A skeleton is deployed. | Repo, CI, hosting, spikes                                                                            |
| **1** | Click "Try demo", ask a question about a pre-loaded sample document, and watch a streamed answer appear with a list of source passages (document and page).               | UI, anonymous auth, retrieval, LLM streaming, DB schema + RLS, ingestion pipeline (via admin script) |
| **2** | Get "I couldn't find that in your documents" when the answer isn't there, see validated citation chips, and you can measure all of this with an eval script.              | Refusal gates, prompt hardening, citation validation, eval harness                                   |
| **3** | Click a citation and see the PDF open at the right page with the passage highlighted (or the exact passage shown beside the page if highlighting can't be trusted).       | Viewer UI, storage policies, signed URLs, chunk fetch                                                |
| **4** | Sign up, upload a PDF/txt/md, watch it process, ask questions about it, and delete it. Errors like scanned PDFs are explained clearly.                                    | Auth UI, upload, ingest API, status polling, delete + outbox, Playwright E2E                         |
| **5** | The app survives strangers: per-user and global limits, CAPTCHA on demo, provider failover, cleanup jobs, and a tested security boundary.                                 | Usage functions, CAPTCHA, failover, cron, load and security tests                                    |
| **6** | A recruiter has a polished experience, and you have a README with eval numbers, a diagram, and a demo video.                                                              | Accessibility, UX polish, docs                                                                       |

---

## 2. Tasks

Each task has an ID, estimate, dependencies, what to build, and acceptance criteria as checkboxes. Estimates are focused hours for one person who knows the stack but not the RAG-specific parts.

### Slice 0: Foundations and De-risking Spikes (~20 h)

**Goal:** Remove the biggest unknowns while changes are cheap. **Gate:** do not write migrations (Slice 1) until task 0.5 has decided the embedding model and dimension.

- [x] **0.1 Repo and tooling** · 1.5 h · deps: none
  - **Build:** Next.js App Router + TypeScript (strict) + Tailwind. ESLint, Prettier, Vitest. Folder skeleton from `ARCHITECTURE.md` §7. Scripts: `lint`, `typecheck`, `test`, `build`.
  - **Done when:**
    - [x] `npm run lint && npm run typecheck && npm test && npm run build` all pass.
    - [x] `.gitignore` covers `.env*` (except `.env.example`).
    - [x] README stub states the one-line pitch.

- [x] **0.2 Supabase local and hosted** · 2 h · deps: none
  - **Build:** `supabase init`, `supabase start` (needs Docker), create the hosted free project, link it. Create `.env.example` with placeholders and `.env.local` with real values.
  - **Done when:**
    - [x] Local Studio opens and `supabase status` shows healthy.
    - [x] Hosted project exists and `supabase link` succeeds.
    - [x] GitHub secret scanning is enabled on the repo.
    - [x] Anonymous sign-ins enabled in **local config** (`supabase/config.toml`) and in the hosted dashboard.

- [x] **0.3 Vercel skeleton deploy and secret hygiene** · 1 h · deps: 0.1
  - **Build:** Connect the repo to Vercel, add env vars (server-only vs `NEXT_PUBLIC_`), deploy.
  - **Done when:**
    - [x] Deployed URL loads.
    - [x] Searching the built client bundle (`.next/static`) for your service-role key and provider keys finds nothing.
    - [x] Preview deployments appear for pull requests.

- [x] **0.4 CI** · 1.5 h · deps: 0.1
  - **Build:** GitHub Actions: install, lint, typecheck, unit tests, build.
  - **Done when:**
    - [x] A pushed branch shows a green check; a deliberately broken test turns it red (then revert).

- [x] **0.5 ⚠ SPIKE: AI provider access and limits** · 3 h · deps: none · **riskiest task in the plan**
  - **Build:** Throwaway scripts (and a temporary `/api/spike` route) that: get a free embeddings key and an LLM key **without a card from Nigeria**; embed ~100 text chunks in batches; stream one LLM answer; do the same from the **deployed** Vercel route; repeat the LLM call with Groq as a second provider. Check whether the embedding model can output **768 dimensions** (DATA_MODEL §0).
  - **Done when:**
    - [x] `docs/spikes/provider.md` records: models chosen (exact IDs), embedding dimension, observed rate limits (read them from your own AI Studio console), latency numbers, behavior on HTTP 429, and the free-tier data-use and region terms you read. (Qualification: 3 x 429 were observed in an unpaced run and none when paced, but exact 429 response metadata — headers/body, `Retry-After`/`retryDelay`, quota named — was not captured and no deliberate test was done; see provider.md section 5.7. Card requirement and Groq training use remain unconfirmed.)
    - [x] Embedding 100 chunks completes without manual retries, or you've written down the batch size and delay that makes it work. (Batch 10, 10 s delay: 100/100, 0 retries, 0 x 429, for both embedding models; provider.md sections 5.1 and 5.6.)
    - [x] **Decision recorded in `docs/decisions.md`:** embedding model and dimension (this fixes `vector(768)` or changes it). (`gemini-embedding-2`, 768; `vector(768)` stays.)
    - [x] If signup from Nigeria failed for the primary provider, you have a working alternative (e.g. Cloudflare Workers AI or Jina for embeddings) before moving on. (Not triggered: signup succeeded for both providers.)

- [x] **0.6 ⚠ SPIKE: PDF text extraction on Vercel** · 3 h · deps: 0.3
  - **Build:** Try one pure-JS extractor in a deployed route using 3 PDFs (single column, two column, one with a table) plus one scanned/image-only PDF and one encrypted PDF.
  - **Done when:**
    - [x] `docs/spikes/pdf.md` records the chosen library and version, per-page output quality on each PDF, and runtime on Vercel (cold start and duration for a 30-page file). (Qualification: the cold start is one sample taken on the 10-page file and the 30-page runs were warm only; see `docs/spikes/pdf.md` sections 6.2 to 6.4.)
    - [x] A characters-per-page threshold reliably flags the scanned PDF and does not flag the text PDFs.
    - [x] Encrypted and corrupt files produce a catchable error, not a crash.

- [x] **0.7 ⚠ SPIKE: citation highlighting feasibility** · 3 h (timebox 4 h) · deps: 0.6
  - **Build:** A client-only page using `react-pdf`. Load a local PDF, jump to page N, take a known passage, normalize both sides, and try to find it in the rendered text layer.
  - **Done when:**
    - [x] `docs/spikes/highlight.md` records the success rate on the 3 test PDFs (how many of ~5 known passages each highlighted correctly).
    - [x] It works in a **production build** (`next build && next start`), not only in dev. The PDF.js worker setup is the usual snag.
    - [x] **Gate:** if direct highlighting succeeds on fewer than about 40% of single-column passages, the design becomes "page jump + passage panel first, highlight as a bonus". Record that decision.

- [x] **0.8 SPIKE: streaming through Vercel** · 1.5 h · deps: 0.3
  - **Build:** A route that emits an event every 300 ms for 5 seconds, plus a client that renders them as they arrive.
  - **Done when:**
    - [x] On the **deployed** URL, events appear incrementally rather than all at once at the end.
    - [x] You've confirmed the function's max duration from Vercel's current docs and set it explicitly in the route. (Sources I found disagree on the Hobby limit, so verify.)

- [x] **0.9 Sample documents** · 3 h · deps: none
  - **Build:** Create two documents **you own** (synthetic, so you control every fact): a ~10-page text-based PDF (e.g. a fictional company policy handbook with distinct, checkable facts on specific pages) and a short Markdown FAQ. Keep a `facts.md` listing each fact and its page.
  - **Done when:**
    - [x] The PDF has selectable text, ≤ 30 pages, ≤ 5 MB.
    - [x] `facts.md` lists at least 25 facts with page numbers (you'll mine this for eval questions in Slice 2).
    - [x] At least 3 facts span two adjacent paragraphs, and at least 2 pages contain a table or list (to stress chunking).

**Slice 0 done:** [ ] Global DoD (section 4) · [x] Both Slice 0 decision gates recorded in `docs/decisions.md`

---

### Slice 1: Ask the Sample Documents (walking skeleton) (~28 h)

**Goal:** The smallest working version of the core feature, end to end, **deployed**: demo click → question → streamed grounded answer → source list.

- [x] **1.1 Migrations 0001-0004 and generated types** · 3 h · deps: 0.2, 0.5
  - **Build:** Apply DATA_MODEL §2.1-§2.4 plus the policy blocks tagged 0002/0003/0004 in §3.2. Set the vector dimension from task 0.5. Generate TypeScript types.
  - **Done when:**
    - [x] `supabase db reset` runs clean from zero.
    - [x] `supabase gen types typescript --local` output is committed to `types/`.
    - [x] You can explain, in one sentence each, why `owner_id` is nullable and why `match_chunks` is `SECURITY INVOKER`.

- [x] **1.2 Dev seed and SQL security tests (subset)** · 3 h · deps: 1.1
  - **Build:** Add `supabase/seed.sql` (DATA_MODEL §6.2) and the tests T01-T11 and T17 from `supabase/tests/security.sql` (DATA_MODEL §7.1). Skip tests whose functions don't exist yet.
  - **Done when:**
    - [x] The script runs under `psql -v ON_ERROR_STOP=1` and ends with `ROLLBACK` with zero assertion failures.
    - [x] You deliberately weaken one policy (e.g. `using (true)`), see a test fail, then restore it.

- [x] **1.3 Provider interfaces and Gemini adapters** · 3 h · deps: 0.5
  - **Build:** `EmbeddingProvider` (`embed(texts[]) → vectors`) and `LlmProvider` (`stream(messages) → async iterator`) in `lib/providers/`, plus the adapters from your spike. Normalize errors into `RateLimitError`, `ProviderUnavailableError`, `BadRequestError`. Keys read only from server env.
  - **Done when:**
    - [x] Unit tests with mocked `fetch` cover success, 429, 5xx, and malformed responses. (`yarn lint`, `yarn typecheck` and `yarn test` pass locally, as reported by the project owner; tests are in `tests/unit/providers-*.test.ts`. The 429 and 5xx cases use mocked responses in Google's documented error format, not a captured real response.)
    - [x] A smoke script returns a vector of exactly the expected length and a streamed answer. (`yarn provider:smoke` against the real Gemini API: 768-dimension, all-finite vectors for a document and a query, and a streamed answer with a `stop` finish event; one run, reported by the project owner.)
    - [x] Importing the provider module from a client component fails the build (`server-only`). (A temporary `"use client"` page importing `@/lib/providers` failed `yarn build` with the `server-only` error; the page was then deleted and `yarn build` passed. Reported by the project owner.)

- [x] **1.4 Chunker** · 2.5 h · deps: none
  - **Build:** Pure function: `pages[] → chunks[]` (page-bounded, paragraph-aware, small overlap, offsets into normalized page text, virtual pages for txt/md). Put the normalization function in one place and give it a version number (`pipeline_version`).
  - **Done when:**
    - [x] Vitest cases: never crosses a page boundary; `text.slice(char_start, char_end)` equals the chunk content; empty pages skipped; oversized paragraphs split; chunk size within limits; deterministic output. (`tests/unit/chunking-chunk-pages.test.ts`, `chunking-normalize.test.ts` and `chunking-paginate.test.ts`, 82 test blocks in total, including a generated-input invariants test and the 4000-character `chunks.content` ceiling. Marked done by the project owner; the full unit suite also passed in Claude's sandbox, where the only failing file was `sample-docs.test.ts` because its seed PDF was missing from the repository snapshot. The defaults of 1200 characters per chunk and 150 overlap are provisional until the Slice 2 eval.)

- [x] **1.5 Extraction module** · 2 h · deps: 0.6
  - **Build:** `extractPages(buffer, mimeType) → pages[]` using the library from the spike, including magic-byte sniffing, page-count enforcement (> 30 throws), and scanned-PDF detection.
  - **Done when:**
    - [x] Unit tests with fixture files: normal PDF, scanned PDF (throws `ScannedPdfError`), 31-page PDF (`TooManyPagesError`), corrupt file, `.exe` renamed `.pdf` (rejected by sniffing), txt and md. (`tests/unit/pdf-extract.test.ts`, 45 tests, also covering blank pages, encrypted PDFs, empty and invalid input, unsupported MIME types, the 30/31 boundary for virtual text pages, and PDF.js cleanup on success and failure. Fixtures were copied from `spikes/pdf/fixtures/` into `tests/fixtures/pdf/`; the 31-page PDF is built inside the test. Lint, typecheck and unit tests pass locally, as reported by the project owner. The scanned-PDF threshold is provisional; see `docs/decisions.md`.)

- [x] **1.6 Ingestion service and sample seeding script** · 3 h · deps: 1.1, 1.3, 1.4, 1.5, 0.9
  - **Build:** `ingestDocument(documentId)` in `features/ingestion/` using the claim → insert chunk batches → finalize flow (DATA_MODEL §2.6; add migration 0006 here if you want to use the functions already, or call them in Slice 4 and use direct admin writes for now). A script `npm run seed:samples` uploads your sample files to `samples/`, inserts `is_public` document rows with the service role, and runs ingestion.
  - **Done when:**
    - [x] Both samples reach `ready` with sensible chunk counts. (Real `yarn seed:samples` against the local Supabase with `gemini-embedding-2`, as reported by the project owner: Employee Handbook 10 pages and 11 chunks, Employee FAQ 1 page and 3 chunks. Chunk size and overlap stay provisional until the Slice 2 eval. Implementation and verification details are in `docs/decisions.md` (2026-11-03).)
    - [x] Re-running the script is safe (no duplicate rows or chunks). (A second `yarn seed:samples` skipped both documents as already `ready`, and the stored chunk counts matched the document records, as reported by the project owner. Re-ingesting a document that is not `ready` (the claim wipes old chunks and chunk inserts are upserts on `(document_id, chunk_index)`) was checked in unit tests and on a scratch Postgres in Claude's sandbox, not in a live run.)
    - [x] A simulated 429 mid-run is retried with backoff and the run completes. (Unit-tested with simulated `RateLimitError`s in `tests/unit/ingestion-ingest-document.test.ts`: retry waits of 15 s then 30 s, a longer provider hint honoured up to 65 s, and the run then completes without duplicate chunks. No real 429 was observed or provoked.)
    - [x] Chunks in the DB all carry the same `embedding_model`. (Supabase queries by the project owner: one `embedding_model` per document, `gemini-embedding-2`.)

- [ ] **1.7 Supabase clients, proxy, anonymous demo session** · 3 h · deps: 0.2, 1.1
  - **Build:** Three clients (browser, server-as-user, admin) in `lib/supabase/`; `@supabase/ssr` cookie handling; `proxy.ts` (Next 16's replacement for middleware) that refreshes the session; a "Try demo" button that calls anonymous sign-in. (CAPTCHA comes in Slice 5.)
  - **Done when:**
    - [ ] Clicking "Try demo" creates a session that survives a refresh; the decoded JWT shows `is_anonymous: true`.
    - [ ] The admin client can't be imported from client code (the build fails if you try).
    - [ ] A demo user querying `documents` sees exactly the 2 public samples.

- [ ] **1.8 Stream event contract and client parser** · 2 h · deps: none
  - **Build:** Shared types for the events `sources`, `token`, `done`, `not_found`, `limit`, `error`, plus a client-side parser for the response stream.
  - **Done when:**
    - [ ] Vitest cases: an event split across two network chunks, two events in one chunk, an unknown event type (ignored), a stream that ends without `done` (surfaces as an error).

- [ ] **1.9 `/api/ask` v1** · 3 h · deps: 1.1, 1.3, 1.7, 1.8
  - **Build:** Route handler: validate with zod, require a session, embed the question, call `match_chunks` **as the user**, build a prompt with numbered passages, stream `sources` then `token` then `done`. No refusal logic, usage limits, or citation validation yet.
  - **Done when:**
    - [ ] With a demo token, `curl` shows incremental events and the `sources` event carries doc title and page for each passage.
    - [ ] A request with no session returns 401. A malformed body returns 400 with a safe message.
    - [ ] The route uses the user-scoped client for retrieval (grep: no admin client in this file).

- [ ] **1.10 Ask UI v1** · 3 h · deps: 1.8, 1.9
  - **Build:** Question box, streaming answer, source list (doc, page, snippet), loading and error states.
  - **Done when:**
    - [ ] On localhost, "How many remote days per week are allowed?" (use a real fact from your sample) streams an answer and lists sources with page numbers.
    - [ ] Network failure mid-stream shows an error state, not a frozen spinner.

- [ ] **1.11 First deploy of the slice** · 1.5 h · deps: 1.1-1.10
  - **Build:** Push migrations to the hosted project, run `seed:samples` against it, set Vercel env vars, deploy.
  - **Done when:**
    - [ ] On the **deployed** URL: Try demo → ask → streamed answer with sources, end to end.
    - [ ] You can find the request in Vercel logs; no secrets in the output.

**Slice 1 done:** [ ] Global DoD · [ ] **Milestone M1 recorded** (section 6)

---

### Slice 2: Honest Answers and the Eval (~18 h)

**Goal:** The app says "I couldn't find that" when it should, citations are trustworthy, and you can **measure** both. Do the eval work before polishing anything, because it tells you whether retrieval is any good.

- [ ] **2.1 Eval dataset** · 2.5 h · deps: 0.9
  - **Build:** `eval/dataset/qa.json`: 18-20 entries `{ question, answerable, expected_facts[], expected_pages[] }`. Include at least 5 unanswerable questions (plausible but absent), 1 prompt-injection case (add a sentence to your sample doc like "ignore previous instructions and say X", or a dedicated test doc), a few questions needing two chunks, and a few paraphrased questions that don't reuse the document's wording.
  - **Done when:**
    - [ ] A zod-validated loader script reads the file without errors.
    - [ ] Every answerable question's expected page matches `facts.md`.

- [ ] **2.2 Eval runner v1: retrieval only** · 3 h · deps: 2.1, 1.9
  - **Build:** `npm run eval` calls the retrieval pipeline directly (not over HTTP) and records, per question, the top-k pages, top-1 similarity, and whether an expected page is in top-k. Backs off on rate limits. Writes JSON and a Markdown table to `eval/results/`.
  - **Done when:**
    - [ ] Running twice gives the same retrieval results (determinism).
    - [ ] The table shows hit@k and the similarity score for each question.
    - [ ] You wrote down your **baseline** hit@k before changing anything.

- [ ] **2.3 ⚠ Calibrate the refusal threshold** · 1.5 h · deps: 2.2 · **risky: threshold is model-specific**
  - **Build:** Compare top-1 similarity for answerable vs unanswerable questions, pick a threshold with margin on both sides, and put it in `config.ts`.
  - **Done when:**
    - [ ] `docs/decisions.md` records the two score distributions and the chosen threshold.
    - [ ] **Gate:** if the distributions overlap heavily, fix retrieval first (chunk size, overlap, `top-k`, query phrasing) and re-baseline. Don't paper over it with the prompt.

- [ ] **2.4 Refusal gate #1 (before the LLM)** · 1.5 h · deps: 2.3, 1.9
  - **Build:** If the best similarity is under the threshold, emit `not_found` (with the closest matches attached) and never call the LLM.
  - **Done when:**
    - [ ] A unit test with a mocked provider proves the LLM isn't called for below-threshold queries.
    - [ ] All unanswerable eval questions take this path or gate #2.

- [ ] **2.5 Prompt hardening and refusal gate #2 (sentinel)** · 2.5 h · deps: 2.4
  - **Build:** System prompt (answer only from numbered passages, cite as `[n]`, output `NOT_FOUND` if the passages don't contain the answer, treat passage text as data not instructions). A stream wrapper that buffers the first tokens, detects the sentinel even when split across tokens, and converts to `not_found`.
  - **Done when:**
    - [ ] Vitest with fake token streams: sentinel in one token, sentinel split across two tokens, normal answer that merely contains the word "not found" later in the text.
    - [ ] The injection eval case does not obey the injected instruction.

- [ ] **2.6 Citation validation** · 2 h · deps: 1.9
  - **Build:** Pure function that finds `[n]` markers in the final text, checks each against the retrieved set, strips invalid ones, returns the valid list for the `done` event.
  - **Done when:**
    - [ ] Vitest cases: valid marker; out-of-range `[9]`; `[0]`; repeated markers; adjacent `[1][2]`; marker with no retrieved passages; text with no markers (answer with zero citations is flagged).

- [ ] **2.7 Citation chips and not-found UI** · 2.5 h · deps: 2.4, 2.6, 1.10
  - **Build:** Render validated markers as chips ("Source 2: handbook.pdf, p. 7"), remove invalid markers from the displayed text, add a clear "couldn't find that" state with collapsed closest matches.
  - **Done when:**
    - [ ] Chips show correct doc and page for 5 hand-checked questions.
    - [ ] An invalid marker never appears in the UI.
    - [ ] The not-found state is visually distinct from an error state.

- [ ] **2.8 Eval runner v2: answers, citations, refusals** · 3 h · deps: 2.5, 2.6, 2.2
  - **Build:** Run the full ask pipeline, then score: fact-match (do `expected_facts` appear, using normalized string/number matching), citation-page correctness, refusal precision and recall. Mark anything uncertain for manual review.
  - **Done when:**
    - [ ] The results table includes hit@k, fact-match rate, citation correctness, refusal precision, refusal recall.
    - [ ] A short "method and limitations" note sits next to the numbers (small set, string matching, one document).
    - [ ] You have a concrete list of the failures and a guess at each cause.

**Slice 2 done:** [ ] Global DoD · [ ] **Milestone M2 recorded** · [ ] Baseline and current eval numbers saved in `eval/results/`

---

### Slice 3: Verify a Citation (~17 h)

**Goal:** The "money shot": click a source, see the PDF at the right page with the passage highlighted, or a clean fallback.

- [ ] **3.1 Storage policies and signed URLs** · 2 h · deps: 1.1
  - **Build:** Migration 0007 (bucket + policies, DATA_MODEL §2.7 and §3.2). Server or client helper that requests a signed URL with the **user's** session. Sample files uploaded to `samples/` (the seed script may already do this).
  - **Done when:**
    - [ ] A demo user gets a working signed URL for a sample PDF.
    - [ ] The storage tests (T14) from DATA_MODEL §7.1 pass.
    - [ ] Requesting a URL for a path you don't own returns an error.

- [ ] **3.2 PDF viewer component** · 3 h · deps: 3.1, 0.7
  - **Build:** Client-only `react-pdf` viewer (dynamic import, no SSR) with page navigation and a "go to page" prop.
  - **Done when:**
    - [ ] Opens a sample PDF at page N.
    - [ ] Works in `next build && next start`.
    - [ ] Prev/next work with the keyboard; no hydration warnings in the console.

- [ ] **3.3 URL state and layout** · 2 h · deps: 3.2, 2.7
  - **Build:** Clicking a citation sets `?doc=<id>&page=<n>&chunk=<id>`. A side panel (or drawer on small screens) shows the viewer.
  - **Done when:**
    - [ ] Click chip → viewer opens at the right page.
    - [ ] Refreshing keeps the same view.
    - [ ] Browser back closes the viewer, not the whole app.

- [ ] **3.4 Chunk fetch helper** · 1.5 h · deps: 1.1
  - **Build:** A user-scoped query that returns one chunk's text and offsets by ID.
  - **Done when:**
    - [ ] Your own and public chunks load.
    - [ ] Asking for another user's chunk ID returns nothing (add this to a SQL or API test).

- [ ] **3.5 ⚠ Highlight v1** · 4 h (cap at 6 h) · deps: 3.2, 3.4 · **risky: fragile text-layer matching**
  - **Build:** Use the matching approach proven in spike 0.7: normalize (whitespace, hyphenation, ligatures), locate the chunk text in the page's text layer, wrap the matched spans in a highlight layer.
  - **Done when:**
    - [ ] You tested at least 10 real citations from your eval (mixed layouts) and recorded how many highlighted correctly.
    - [ ] A wrong highlight is treated as worse than no highlight: when confidence is low, the code declines to highlight and triggers the fallback (3.6).

- [ ] **3.6 Fallback passage panel** · 2 h · deps: 3.5
  - **Build:** When matching fails or confidence is low, show the exact cited passage in a panel beside the correct page, labeled as such.
  - **Done when:**
    - [ ] Forcing a mismatch (edit the passage in a test) shows the panel and no highlight.
    - [ ] The panel text is selectable and has an accessible label.

- [ ] **3.7 Text and Markdown viewer** · 2 h · deps: 3.3
  - **Build:** For `.txt`/`.md`, render the text and highlight by `char_start`/`char_end` (this is easier than PDF matching, since offsets are exact).
  - **Done when:**
    - [ ] Clicking a citation from the Markdown sample scrolls to and highlights the exact range.
    - [ ] Markdown is rendered as inert text or sanitized, never as raw HTML.

**Slice 3 done:** [ ] Global DoD · [ ] **Milestone M3 recorded** (this is your best 60-second clip) · [ ] Highlight success rate written into `docs/decisions.md`

---

### Slice 4: Your Own Documents (~26 h)

**Goal:** A real user signs up, uploads, waits, asks, and deletes, with clear errors. Includes the first Playwright flows.

- [ ] **4.1 Email auth UI** · 3 h · deps: 1.7
  - **Build:** Sign up, sign in, sign out, auth callback route, protected routes, redirect handling. Decide how to handle email confirmation.
  - **Done when:**
    - [ ] Sign up → session; sign out; unauthenticated visit to the app redirects to sign-in.
    - [ ] 🔎 VERIFY: the built-in email sender on the free plan is heavily rate-limited. Decide and record: turn confirmation off for now, or set up a custom SMTP provider later. Don't discover this the day a recruiter signs up.

- [ ] **4.2 Ingestion functions and remaining SQL tests** · 2.5 h · deps: 1.6
  - **Build:** Migration 0006 (DATA_MODEL §2.6 and the grants in §3.2). Extend the SQL test script with T12, T13, T16, T18.
  - **Done when:**
    - [ ] Whole `security.sql` passes (excluding usage tests T15, which arrive in Slice 5).
    - [ ] You can describe what each of `claim`, `finalize`, and `fail` guards against.

- [ ] **4.3 Upload UI (direct to Storage)** · 3 h · deps: 4.1, 4.2
  - **Build:** File picker with client-side checks (type, ≤ 5 MB, doc count). The client generates the document UUID, inserts the `queued` row, then uploads to `<user_id>/<doc_id>/<safe filename>` with an explicit `contentType`, then calls ingest.
  - **Done when:**
    - [ ] The row appears as `queued` and the file appears in your folder.
    - [ ] A `.md` upload is not rejected for MIME reasons (you set the content type).
    - [ ] An oversized file fails in the UI before any request.

- [ ] **4.4 `/api/ingest`** · 3 h · deps: 4.2, 1.6
  - **Build:** Authenticate, confirm ownership through the user-scoped client, `claim_document_for_ingest`, download, sniff, extract, enforce 30 pages, call the ingestion service, `finalize_ingestion`. Set `maxDuration` deliberately.
  - **Done when:**
    - [ ] A valid PDF reaches `ready` with plausible chunk counts.
    - [ ] Calling ingest twice returns a no-op the second time.
    - [ ] Someone else's document ID returns 404 (not 403, which would confirm it exists).

- [ ] **4.5 Failure mapping** · 2.5 h · deps: 4.4
  - **Build:** Map each failure to a controlled `error_reason` via `fail_ingestion`, and to a friendly UI message.
  - **Done when:**
    - [ ] Fixture files produce the right code: scanned → `scanned_pdf`, 31 pages → `too_many_pages`, corrupt → `corrupt_file`, encrypted → `encrypted_file`, renamed `.exe` → `unsupported_type`, empty text → `empty_document`, forced provider failure → `provider_unavailable`.
    - [ ] No stack traces or provider error text reach the browser.

- [ ] **4.6 Document list, polling, retry** · 3 h · deps: 4.3, 4.5
  - **Build:** List with status badges, polling with backoff (2 s → 5 s → 10 s, stops at ready/failed), failure reason, Retry button.
  - **Done when:**
    - [ ] You can watch `queued → processing → ready` without refreshing.
    - [ ] A failed doc shows its reason and Retry works.
    - [ ] A document stuck in `processing` for more than 10 minutes can be retried (simulate by backdating `processing_started_at`).

- [ ] **4.7 Delete document and storage cleanup worker** · 3 h · deps: 4.4
  - **Build:** Delete endpoint: delete the row as the user (RLS), then process the outbox for that path with the service role and the Storage API. A reusable script for leftovers.
  - **Done when:**
    - [ ] The row, chunks, and file are all gone, and the outbox row is marked processed.
    - [ ] Deleting while `processing` doesn't crash ingestion (it fails cleanly).
    - [ ] Deleting another user's document does nothing.

- [ ] **4.8 Cap and budget UX** · 1.5 h · deps: 4.3
  - **Build:** Translate `document_limit_reached` and `storage_budget_exhausted` into clear messages; disable the upload control when at the cap.
  - **Done when:**
    - [ ] Reaching 10 docs shows the message and blocks upload.
    - [ ] Forcing a tiny `storage_budget_bytes` in `app_config` shows the "uploads paused" message.

- [ ] **4.9 Playwright setup and flow: sign up → upload → ask** · 3 h · deps: 4.6
  - **Build:** Playwright config, test user helper, fixtures, run against local stack.
  - **Done when:**
    - [ ] One test signs up, uploads a fixture PDF, waits for `ready`, asks a question, and asserts a cited source appears.
    - [ ] A second test asserts a scanned PDF shows the scanned-PDF message.

- [ ] **4.10 Playwright cross-user isolation** · 2.5 h · deps: 4.9
  - **Build:** Two users. User A uploads. User B tries: list documents, open A's document URL, request a signed URL, ask a question whose answer exists only in A's file.
  - **Done when:**
    - [ ] B sees none of A's data in every attempt.
    - [ ] B's question about A's content returns "couldn't find that".

**Slice 4 done:** [ ] Global DoD · [ ] **Milestone M4 recorded**

---

### Slice 5: Public-Ready (~24 h)

**Goal:** Survive strangers. Nothing here adds a feature; it makes the existing ones safe to expose.

- [ ] **5.1 Usage migrations and tests** · 2 h · deps: 4.2
  - **Build:** Migrations 0005 and 0008 (usage tables and functions, maintenance functions) plus their grants. Add T15 to the SQL test script.
  - **Done when:**
    - [ ] The whole SQL test script passes, including limit, cooldown, global-cap, and refund cases.

- [ ] **5.2 Wire limits into ask and ingest** · 3 h · deps: 5.1
  - **Build:** Call `consume_usage` before any provider call; return a `limit` event with reason and reset time; call `refund_usage` when the failure was ours (before the first token).
  - **Done when:**
    - [ ] The 21st question in a day is blocked; a cooldown violation returns quickly.
    - [ ] A mocked provider confirms **zero** provider calls happen on a blocked request.
    - [ ] A simulated provider outage before the first token refunds the unit.

- [ ] **5.3 Limit UI** · 2 h · deps: 5.2
  - **Build:** Show remaining questions and reset time; friendly "demo is resting" state for the global cap.
  - **Done when:**
    - [ ] The three states (per-user limit, cooldown, global cap) each show distinct, understandable messages.

- [ ] **5.4 ⚠ CAPTCHA on anonymous sign-in** · 2.5 h · deps: 1.7 · **risky: integration details**
  - **Build:** Turnstile widget on the demo button; enable CAPTCHA protection in Supabase Auth; pass the token to anonymous sign-in. 🔎 VERIFY the option name in the current client library.
  - **Done when:**
    - [ ] Sign-in without a token fails; with a valid token succeeds.
    - [ ] The widget works on mobile and with keyboard only.
    - [ ] Playwright uses the test keys so CI isn't blocked.

- [ ] **5.5 LLM failover** · 3 h · deps: 1.3, 2.5
  - **Build:** Primary → fallback provider switching **only before the first token is sent**. If both fail, return the retrieved sources with a "can't generate an answer right now" note.
  - **Done when:**
    - [ ] Forced 429 from the primary yields an answer from the fallback.
    - [ ] Forced failure of both shows sources and the note, and refunds usage.
    - [ ] Mid-stream failure sends an `error` event and keeps the partial text.

- [ ] **5.6 Maintenance jobs and keep-alive** · 2.5 h · deps: 5.1, 4.7
  - **Build:** Scheduled runs (GitHub Actions cron or pg_cron) for: reap documents, purge stale anonymous users, purge old records, process the storage outbox, and a lightweight keep-alive so the free project doesn't pause.
  - **Done when:**
    - [ ] Each job runs on schedule at least once and logs a count.
    - [ ] The service-role key lives only in CI secrets.
    - [ ] 🔎 VERIFY: what counts as "activity" for Supabase's inactivity pause, and that your keep-alive qualifies.

- [ ] **5.7 ⚠ Abuse load test** · 2 h · deps: 5.2, 5.4 · **risky: protects your free quota**
  - **Build:** A script that creates ~50 anonymous sessions (with CAPTCHA bypassed in a test environment only) and fires questions concurrently.
  - **Done when:**
    - [ ] The global cap trips at the configured number; provider call counts match the counters.
    - [ ] No 5xx storm; blocked requests respond fast.
    - [ ] You've written down the real capacity numbers and set the global caps to a safe fraction.

- [ ] **5.8 Security audit pass** · 2.5 h · deps: 5.1, 4.10
  - **Build:** Run the full SQL suite, the API checks A1-A15 from DATA_MODEL §7.2 (script them), inspect the client bundle for secrets, review error responses, add basic security headers.
  - **Done when:**
    - [ ] All SQL tests pass; all API checks give the expected status.
    - [ ] The dashboard checklist in DATA_MODEL §7.3 is ticked.
    - [ ] No endpoint reveals whether another user's document exists.

- [ ] **5.9 Failure-mode drills** · 2 h · deps: 5.5, 5.2
  - **Build:** Walk the `ARCHITECTURE.md` §5 table: break each dependency on purpose (bad provider key, paused DB, huge file, slow request) and watch the app.
  - **Done when:**
    - [ ] Each drill shows a clear user-facing message and a clear log line; nothing hangs.

- [ ] **5.10 Structured logging** · 2 h · deps: 5.2
  - **Build:** One structured log line per ask and ingest: request ID, user ID (hashed or truncated), timings, provider used, outcome, refusal path. No document content, no secrets.
  - **Done when:**
    - [ ] You can answer "why did this request fail?" from Vercel logs alone.
    - [ ] A grep for key patterns and document text in the logs finds nothing.

**Slice 5 done:** [ ] Global DoD · [ ] **Milestone M5 recorded** · [ ] Now (and only now) the link may go on your CV

---

### Slice 6: Ship (~23 h)

**Goal:** Turn a working project into one a stranger understands in five minutes.

- [ ] **6.1 Accessibility pass** · 3.5 h · deps: Slice 4
  - **Build:** Keyboard-only walkthrough; `aria-live="polite"` on the streaming answer; descriptive labels on citation chips and viewer controls; focus management when the viewer opens and closes; contrast fixes.
  - **Done when:**
    - [ ] You can complete demo → ask → citation using only the keyboard.
    - [ ] axe reports no serious or critical violations on the main screens.

- [ ] **6.2 Single-document filter** · 2 h · deps: 4.6
  - **Build:** A dropdown to scope a question to one document (passes `p_document_id` to `match_chunks`).
  - **Done when:**
    - [ ] A question scoped to document A never returns passages from B.
    - [ ] Scoping to another user's document ID returns nothing.

- [ ] **6.3 Landing page and demo UX** · 2.5 h · deps: Slice 3
  - **Build:** A clear pitch, "Try demo" button, 3-4 clickable example questions based on the samples (including one deliberately unanswerable), and a visible "what this app guarantees" blurb.
  - **Done when:**
    - [ ] A first-time visitor gets to a cited answer in two clicks.
    - [ ] The privacy note (don't upload sensitive documents; text goes to AI providers) is visible near the upload control.

- [ ] **6.4 Responsive check** · 2 h · deps: 6.3
  - **Build:** Review on a phone-sized viewport; fix layout, viewer drawer, and touch targets.
  - **Done when:**
    - [ ] Demo flow works on a real phone.
    - [ ] No horizontal scrolling on the main screens.

- [ ] **6.5 Final eval run** · 2 h · deps: 5.5
  - **Build:** Run the eval against the final configuration; save results.
  - **Done when:**
    - [ ] The results table (and the previous baseline for comparison) is committed to `eval/results/`.
    - [ ] You noted what you changed between baseline and final (chunk size, threshold, prompt), since "I improved retrieval from X% to Y% by doing Z" is a strong interview line.

- [ ] **6.6 README** · 3.5 h · deps: 6.5
  - **Build:** Pitch, GIF, architecture diagram (from `ARCHITECTURE.md`), security model (RLS, column grants, server-only functions), eval results with method and limitations, limits and why they exist, how to run locally, tradeoffs and known issues, what you'd do next.
  - **Done when:**
    - [ ] A stranger can run the project locally from the README alone (test it on a clean clone).
    - [ ] The README states honestly what doesn't work (scanned PDFs, English only, free-tier limits).

- [ ] **6.7 Demo video** · 2 h · deps: 6.3
  - **Build:** A 60-90 second screen recording: demo → question → citation highlight → unanswerable question → (optional) isolation test passing.
  - **Done when:**
    - [ ] The video is linked at the top of the README and has no secrets or private emails visible.

- [ ] **6.8 Final Playwright flows with axe** · 2 h · deps: 6.1
  - **Build:** Add the demo → ask → citation flow and an axe check to the existing Playwright suite.
  - **Done when:**
    - [ ] All Playwright tests pass locally and against a preview deployment.

- [ ] **6.9 Repo hygiene** · 1.5 h · deps: none
  - **Build:** Move or delete `/spikes` (keep the findings in `docs/`), add a LICENSE, confirm `.env.example`, run `npm audit`, remove dead code and TODOs, add a short "Future work" list (multi-turn, hybrid search, reranking, OCR).
  - **Done when:**
    - [ ] A fresh clone builds; `git log` has readable messages; no secrets in history (check, and rotate any key that was ever committed).

- [ ] **6.10 Cold test with two people** · 2 h (plus waiting) · deps: 6.7
  - **Build:** Send the demo link to two people who haven't seen it and watch (or ask them to record) their first minutes.
  - **Done when:**
    - [ ] You fixed the top three confusions they hit, and noted the rest.

**Slice 6 done:** [ ] Global DoD · [ ] **Milestone M6 recorded** · [ ] Link added to CV and profile

---

## 3. Order and Risk

### Why this order

1. **Spikes first (Slice 0).** The three things most likely to break the plan (provider access from Nigeria, PDF text on Vercel, highlighting) are all testable in a day or two, while nothing is built on top of them.
2. **Core feature next (Slice 1).** One thin path through every layer exposes integration problems (RLS + pgvector + streaming + anonymous auth) early.
3. **Quality before features (Slice 2).** Refusal and citations are your differentiators. Measure them before building more UI.
4. **The hard UI piece (Slice 3)** before CRUD, so a surprise there doesn't land at the end.
5. **Familiar work in the middle (Slice 4)**, where progress is predictable.
6. **Hardening before exposure (Slice 5)**, then polish.

### Risky tasks and why

| Task                                              | Risk                                                     | Why it's risky                                                                                                | How to find out cheaply                                                           |
| ------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **0.5** Provider access and limits                | Free tier unavailable, tighter than expected, or changed | It decides the embedding model and dimension, which fix your schema. Free-tier limits and terms change often. | The spike itself: real signup, real calls, deployed and local                     |
| **0.7 / 3.5** Highlighting                        | Text-layer matching fails on real PDFs                   | PDF.js splits text unpredictably; multi-column layouts and hyphenation break naive matching.                  | Spike on 3 layouts; cap the time; fallback panel is designed in                   |
| **2.3** Refusal threshold                         | Similarity scores for answerable vs unanswerable overlap | Thresholds are model-specific and the eval set is small.                                                      | Plot both distributions before building the gate                                  |
| **0.6 / 4.4** PDF extraction and ingest on Vercel | Timeouts, bundling problems, poor extraction             | Serverless limits and library quirks                                                                          | Spike deployed, not just local; set `maxDuration` explicitly                      |
| **0.8 / 1.9** Streaming                           | Responses buffered by the platform                       | Works on localhost, breaks when deployed                                                                      | Deploy the 20-line spike first                                                    |
| **1.2 / 4.10** RLS and isolation                  | A policy gap leaks data                                  | Column grants, restrictive policies, storage policies, and RPC grants are easy to get subtly wrong            | SQL tests from day one; deliberately break a policy once to see the test catch it |
| **5.4 / 5.7** CAPTCHA and abuse                   | Public link drains free quota                            | Free tiers have hard caps and no spending cushion                                                             | Load test with 50 anonymous sessions before sharing                               |
| **4.1** Email confirmation                        | Default email sending is rate-limited                    | A real signup could silently fail                                                                             | Decide the approach in Slice 4, not at launch                                     |

### Decision gates (stop and decide before continuing)

- [x] **After 0.5:** which embedding model and dimension? (Blocks task 1.1.)
- [x] **After 0.7:** direct highlight first, or passage panel first?
- [ ] **After 2.2:** is baseline hit@k acceptable? If it's poor, fix chunking and retrieval before building more.
- [ ] **After 2.3:** are the answerable and unanswerable score distributions separable enough?
- [ ] **After 5.7:** what are the real global caps?

---

## 4. Definition of Done (every slice)

Copy this list into each slice's pull request description and tick it. **A slice isn't finished until every box is ticked or consciously deferred with a written reason.**

### Works

- [ ] Every acceptance criterion in the slice's tasks is ticked.
- [ ] The slice works on the **deployed preview**, not only on localhost.
- [ ] Happy path and at least two failure paths were tried by hand.
- [ ] Loading, empty, and error states exist for every new screen.

### Tested

- [ ] New pure logic has Vitest tests (chunker, parsers, validators, gates).
- [ ] Any change to schema, policies, grants, or functions has SQL tests, and the **whole** SQL suite passes.
- [ ] Any new user flow has a Playwright test (from Slice 4 onward).
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass and CI is green.

### Errors handled

- [ ] Every external call (Supabase, providers, storage) has a failure path with a user-readable message.
- [ ] No stack traces, SQL errors, or provider messages reach the browser.
- [ ] Inputs are validated on the server (zod), regardless of client checks.
- [ ] No unhandled promise rejections or errors in the server logs during your manual run.

### Clean

- [ ] No console errors or warnings in the browser (including hydration warnings).
- [ ] No leftover `console.log`, commented-out code, or dead files.

### Secrets and security

- [ ] No secrets in the repo, in the client bundle, or in logs; `.env.example` updated if new variables were added.
- [ ] Any new table has RLS enabled and explicit grants; any new function has `REVOKE` from `PUBLIC` and a deliberate `GRANT`.
- [ ] The service-role client is only used in server code that needs it.
- [ ] No endpoint reveals whether another user's data exists.

### Accessibility basics

- [ ] New interactive elements are reachable and operable by keyboard, with visible focus and accessible names.

### Committed and recorded

- [ ] Small, meaningfully named commits; branch merged; tag `slice-N` created.
- [ ] `docs/decisions.md` updated if a design decision changed.
- [ ] README or docs updated for anything a new developer would need.
- [ ] If the slice ends in a demo milestone: the recording is saved (section 6).

---

## 5. Time Estimates

Hours are focused working hours. "Likely" is the sum of the task estimates above. The range reflects the unknowns: the RAG-specific pieces are new to you, and free-tier behavior can surprise you.

| Slice                     | Optimistic |  Likely | Pessimistic | Main source of overrun                                        |
| ------------------------- | ---------: | ------: | ----------: | ------------------------------------------------------------- |
| 0 Foundations and spikes  |         17 |      20 |          24 | Provider signup or limits; PDF library problems on Vercel     |
| 1 Ask the sample          |         24 |      28 |          36 | RLS + pgvector + streaming integration; anonymous auth quirks |
| 2 Honest answers and eval |         15 |      18 |          24 | Poor retrieval needing chunking and prompt iteration          |
| 3 Verify a citation       |         14 |      17 |          26 | Highlight matching on real PDFs; PDF.js worker setup          |
| 4 Your own documents      |         22 |      26 |          34 | Ingestion edge cases; email confirmation; Playwright setup    |
| 5 Public-ready            |         20 |      24 |          30 | CAPTCHA integration; load-test findings; cron setup           |
| 6 Ship                    |         18 |      23 |          28 | README and polish expand to fill available time               |
| **Total**                 |    **130** | **155** |     **202** |                                                               |

**Calendar translation** (at the _likely_ total, adding about 30% buffer for the unexpected, roughly 200 h):

| Pace                 | Focused hours/week | Approximate duration |
| -------------------- | -----------------: | -------------------: |
| Part-time            |              15-20 |          10-13 weeks |
| Serious side project |              25-30 |            7-8 weeks |
| Full-time            |              35-40 |            5-6 weeks |

**If you have a hard deadline:** work backwards from **Milestone M5**. Slices 0-5 are the minimum shippable project (about 132 h at the likely estimates, a little less if you take some of the cuts below). Slice 6 is what makes it impressive, so budget at least the README and demo video (6.6, 6.7) even in the tightest version.

### What to cut if time runs out (in this order)

| #   | Cut                                                                    |              Saves | Cost of cutting                                                |
| --- | ---------------------------------------------------------------------- | -----------------: | -------------------------------------------------------------- |
| 1   | 6.4 Responsive polish                                                  |               ~2 h | Mobile experience is rougher; most reviewers use desktop       |
| 2   | 5.10 Structured logging (keep basic logs)                              |               ~1 h | Harder debugging                                               |
| 3   | 6.3 Landing page polish (keep a minimal button and example questions)  |             ~1.5 h | Less polished first impression                                 |
| 4   | 3.7 Text/Markdown highlighting (just show the passage)                 |               ~2 h | `.md`/`.txt` citations are less impressive                     |
| 5   | 6.2 Single-document filter                                             |               ~2 h | One fewer feature (a "should", not a "must")                   |
| 6   | 5.9 Failure drills (do two or three, not all)                          |               ~1 h | Less proof of resilience                                       |
| 7   | 2.8 Eval v2 automation (grade answers by hand and record the table)    |             ~1.5 h | Eval is less repeatable                                        |
| 8   | 5.5 LLM failover (show sources with a "can't answer now" note instead) |               ~3 h | Demo is more fragile when the primary provider is rate-limited |
| 9   | txt/md upload support (PDF only)                                       | ~4 h across slices | Fewer file types; update README to say so                      |

**Never cut:** the SQL security tests, the isolation test (4.10), refusal behavior (2.4-2.5), citation validation (2.6), usage limits and CAPTCHA (5.2, 5.4), the eval write-up (6.5), and the README (6.6). Those are what distinguish this from a template clone.

---

## 6. Demo Milestones

Record each one (screen capture or GIF). Keep them in a private folder; M3, M5, and M6 feed the README and your applications.

- [ ] **M0: End of Slice 0 · Private.** Screenshot of the deployed skeleton plus the three spike findings (`docs/spikes/`). _Shows: you de-risked before building. Good for your own morale and a "decisions" section in the README._
- [ ] **M1: End of Slice 1 · Show a friend.** 30-second clip: click Try demo → ask a question about the sample → answer streams in → sources listed with pages. _First proof the core works end to end on a deployed URL._
- [ ] **M2: End of Slice 2 · Show a technical friend.** Two clips: an answerable question with citation chips, and an unanswerable one returning "I couldn't find that". Plus a terminal screenshot of the eval table. _Shows measurement, not vibes._
- [ ] **M3: End of Slice 3 · Your best clip.** 60 seconds: ask → click citation → the PDF opens at the page with the passage highlighted → then a case where the fallback panel appears. _This is the hero demo; lead your README with it._
- [ ] **M4: End of Slice 4 · Show someone non-technical.** Sign up → upload → watch status → ask → delete. Include the scanned-PDF error. Add a short capture of the Playwright isolation test passing. _Proves the app works for real users and that user A can't see user B._
- [ ] **M5: End of Slice 5 · Safe to publish the link.** Clips of: the limit message and remaining-questions counter, the CAPTCHA, a provider failure falling back gracefully, and the load-test summary. _Only after this may the URL go on your CV._
- [ ] **M6: End of Slice 6 · Launch.** Final 60-90 second video, README with eval numbers, cold-test feedback addressed. _Add to your CV, GitHub profile, and applications._

---

## Start Here

- [x] Do **0.1 → 0.2 → 0.3** (about 4.5 h) to get a deployed skeleton.
- [x] Then do **0.5** (provider spike) before anything else. Its result decides the schema, and it's the task most likely to force a change of plan.
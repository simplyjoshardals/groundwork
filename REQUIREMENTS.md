# Document Q&A: Requirements

A web app where you sign in, upload your own documents (text-based PDFs, `.txt`, `.md`), and ask questions in plain English. It answers using only your files, shows exactly where each answer came from, and opens the PDF at the cited page with the passage highlighted.

**Stack:** Next.js, TypeScript, Tailwind, Supabase (Auth, Storage, Postgres + pgvector), free-tier LLM/embeddings behind a provider abstraction, Playwright + Vitest, deployed on Vercel. **Budget:** $0 (free tiers only).

---

## 1. Problem Statement

**Who it's for:** People who have a handful of PDFs or notes (papers, contracts, manuals, study material) and want fast answers without trusting a chatbot blindly. For the portfolio, the audience is a hiring manager or engineer who has 5 minutes and will click around.

**Problem:** General chatbots answer confidently from anywhere, and you can't tell whether an answer came from your document or from the model's imagination. Verifying means re-reading the document.

**Solution:** Answers come only from the user's own files, every claim links to the exact page and passage, and the app says "I couldn't find that in your documents" when that's the truth.

**Success looks like:**

- A recruiter clicks "Try demo", asks a question, and clicks a citation that opens the PDF at the right page with the passage highlighted. Under 60 seconds, no sign-up.
- On the sample eval set, the README shows measured numbers: retrieval hit rate, citation correctness, and correct refusals on unanswerable questions.
- User A can never read user B's data, demonstrated by a test, not claimed.
- The whole thing runs at $0 and survives a public link without being drained.

**Positioning:** This category is crowded (NotebookLM, Claude Projects, ChatGPT file uploads, many open-source templates). The project is not pitched as a new product. It is a **small, well-engineered, measured RAG system**: RLS-enforced isolation, verifiable citations, calibrated refusals, abuse limits, and an eval. Those are what an interviewer can probe, and most clones have none of them.

---

## 2. User Stories

### MUST have

- **M1.** As a visitor, I can sign up/sign in with email, so my documents are mine.
- **M2.** As a visitor, I can click "Try demo" to get an anonymous session with pre-loaded sample documents, so I can evaluate the app instantly.
- **M3.** As a user, I can upload a text-based PDF, `.txt`, or `.md` file (≤ 5 MB, ≤ 30 pages, ≤ 10 docs total) and see its status (`queued`, `processing`, `ready`, `failed`).
- **M4.** As a user, I get a clear error if I upload a scanned/image-only PDF, an oversized file, or exceed my document count.
- **M5.** As a user, I can ask a question and get an answer streamed from only my documents (plus public samples in demo).
- **M6.** As a user, every answer has numbered citations that resolve to document name and page.
- **M7.** As a user, clicking a citation opens the PDF at that page with the cited passage highlighted (fallback: page jump plus the exact cited text shown beside the page).
- **M8.** As a user, if nothing relevant is found, I'm told so plainly instead of getting a guess.
- **M9.** As a user, my documents are invisible to every other user (RLS on all tables and storage).
- **M10.** As the app owner, I have per-user daily question limits and a global daily cap, so a public link can't exhaust free tiers.
- **M11.** As a user, I can delete a document and everything derived from it (file, chunks, embeddings).

### SHOULD have

- **S1.** Filter a question to a single document (a `WHERE document_id = ?` clause, so cheap).
- **S2.** Show remaining daily questions in the UI.
- **S3.** Retry button for failed ingestion.
- **S4.** Eval harness script plus results table in the README.
- **S5.** Google/GitHub OAuth.
- **S6.** Keyboard-accessible UI with proper focus handling in the streaming answer and PDF viewer.
- **S7.** Show retrieved passages even on refusal ("closest matches, below confidence threshold") for transparency.

### COULD have (later)

- **C1.** Multi-turn chat with query rewriting.
- **C2.** Hybrid search (Postgres full-text + vector, rank fusion).
- **C3.** Reranking step.
- **C4.** Demo users can upload their own documents.
- **C5.** DOCX support.
- **C6.** Answer feedback (thumbs) feeding the eval set.
- **C7.** Admin/usage dashboard.

---

## 3. MVP Definition

**Smallest version worth showing:** demo login → sample docs pre-loaded → ask a question → streamed answer → click citation → PDF opens at the page with the passage highlighted. Plus working refusal behavior, plus real sign-up with upload.

### In

- Email auth + anonymous demo sign-in (with CAPTCHA)
- Upload: PDF (text-based), `.txt`, `.md`; limits 5 MB / 30 pages / 10 docs
- Ingestion with status tracking: extract text per page → chunk → embed → store
- Single-shot Q&A across all accessible documents
- Streaming answer with `[1] [2]` markers, resolved to doc + page on completion
- Citation click → PDF viewer at page, with passage highlight (fallback: page jump + passage panel)
- Similarity-threshold refusal + prompt-level "only use the provided context" rule
- RLS on all tables and the storage bucket; public sample docs readable by everyone, writable by no one
- Server-side per-user and global daily limits
- Provider abstraction for LLM and embeddings (one implementation, one fallback)
- Delete document
- Vitest tests for chunking and citation parsing; Playwright for 3 flows (demo → ask → citation; sign up → upload → ask; cross-user isolation)
- Eval script + README results
- Deployed on Vercel

### Out (explicitly)

- OCR / scanned PDFs (clear error instead)
- Multi-turn conversation
- Hybrid search, reranking
- DOCX or any other file type
- OAuth providers (email + anonymous only for MVP)
- Sharing documents between users, teams, payments
- Background queue infrastructure (no Redis, no Inngest)
- **Uploads in demo mode.** Demo users query the sample docs only. Uploads from anonymous users are the biggest abuse, storage, and content-moderation exposure.
- Non-English documents
- Conversation history persistence (store questions only as needed for rate limiting/eval)

---

## 4. Non-Functional Requirements

### Security & Privacy

- RLS enabled on every table (`documents`, `chunks`, `usage`, any query log) and on storage objects. Policies keyed on `auth.uid()`; sample docs flagged `is_public` with a read-only policy.
- **Vector search runs under the user's identity.** Use a `SECURITY INVOKER` SQL function (`match_chunks`) called via supabase-js with the user's JWT, so RLS applies to retrieval.
- **Prisma bypasses RLS** because it connects with a privileged DB role, which makes it the wrong tool for user-facing queries in a project whose headline feature is RLS. Use Supabase CLI SQL migrations for schema, RLS, and pgvector, and supabase-js with generated types at runtime. Keep Prisma out, or limit it to server-side admin scripts. Drizzle is an alternative if a typed ORM that handles pgvector is wanted.
- Service-role key is server-only, never in client bundles; used only for ingestion and the global usage counter.
- Treat document text as untrusted: the system prompt must resist prompt injection embedded in uploaded files ("ignore previous instructions"). Include one injection case in the eval set.
- Validate file type by content (magic bytes), not just extension. Sanitize filenames. Never render document text as raw HTML.
- Anonymous users: CAPTCHA on sign-in (Cloudflare Turnstile is free) and scheduled cleanup of stale anonymous accounts.

### Performance

- Time to first streamed token: target < 3 s on typical questions.
- Ingestion of a 30-page PDF: target < 60 s end to end, with progress/status visible. Embed in batches; respect provider rate limits with backoff.
- Retrieval: HNSW index, top-k around 5-8; query latency well under 200 ms at this data scale.

### Cost limits ($0)

- Per-user daily question cap (suggested: 20 for signed-up users, 10 for demo) and a global daily cap acting as a kill switch ("demo is resting, back tomorrow").
- Hard upload limits as specified. Total vectors per user are bounded (10 docs × 30 pages).
- Cap output tokens and retrieved context size per question.
- Monitor against Supabase free limits (database size, storage, project auto-pause after inactivity) and Vercel Hobby function duration. **Verify current free-tier numbers before building**, since they change.
- Scheduled ping or documented "wake up" note for Supabase project pausing, so the demo link isn't dead when a recruiter clicks it.

### Reliability & Correctness

- Ingestion is idempotent and retryable; the failed state shows a reason.
- Citation integrity: markers in the model output are validated server-side against the retrieved chunk set. Any marker that doesn't map to a retrieved chunk is stripped, never shown.
- Provider failure (rate-limited, down) degrades gracefully with a clear message and a fallback provider where configured.
- Embedding model and dimension are stored per chunk. **Swapping the embedding provider means re-embedding everything**; the abstraction doesn't make that free.

### Accessibility

- Keyboard navigable end to end; visible focus states.
- Streaming answer in an `aria-live="polite"` region; citations are real buttons/links with descriptive labels ("Source 2: report.pdf, page 7").
- Color contrast ≥ WCAG AA; highlight color is not the only indicator.
- Run axe checks in Playwright on main screens.

### Quality

- Eval set of 15-20 Q/A pairs on one sample document, including 4-5 unanswerable questions and 1 prompt-injection case.
- Report: retrieval hit rate (is the right page in top-k), answer correctness, citation correctness, refusal precision/recall.
- Run the eval as a standalone script, not as Playwright.

---

## 5. Top 5 Risks & Early Tests

| #   | Risk                                                                                                                                        | Quick early test                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Free provider access from Nigeria is unreliable** (signup, regional availability, rate limits, free-tier terms changing).                 | Day-1 spike: get API keys with no card, call both embeddings and generation from a local script and from a deployed Vercel function. Measure real rate limits by embedding a 30-page doc. Do this before any UI.                                       |
| 2   | **Citation highlighting is fragile.** PDF.js text layers split text unpredictably, so matching a chunk to rendered spans often fails.       | Spike with 3 different PDFs (single column, two column, one with tables): store per-page text with chunks, try highlighting by normalized string match, and record the failure rate. Decide the fallback (page jump + passage panel) before polishing. |
| 3   | **Refusal threshold is hard to calibrate.** Similarity scores are model-specific, so a hard-coded cutoff is either too strict or too loose. | Build the 5 unanswerable questions first. Plot top-1 similarity for answerable vs unanswerable questions, pick the threshold from the data, and re-check it after any embedding model change.                                                          |
| 4   | **Demo abuse drains free quotas or storage.** Anonymous sign-in plus a public URL is an open door.                                          | Write the usage table, caps, and CAPTCHA first. Test with a script that creates 50 anonymous sessions and fires questions; confirm the global cap trips and costs stay at zero.                                                                        |
| 5   | **RLS gaps leak data**, especially via vector search, storage, and public sample docs.                                                      | Write the cross-user isolation Playwright test and a SQL-level test before building features: user A uploads, user B queries and requests the file URL directly. Both must return nothing. Confirm `match_chunks` runs as invoker.                     |

**Also watch:** Vercel function timeouts during ingestion (test with a 30-page PDF in production early; if tight, move to a Supabase Edge Function), and streaming plus structured citations (decide the protocol early: send retrieved sources as the first event, stream text with markers, validate at the end).

---

## 6. Scope vs. Time

Time is open-ended, so the risk isn't the calendar. It's that the project never reaches "shippable" and polish gets starved. The scope is feasible, with a few traps:

- **Highest scope risk: pixel-perfect highlighting.** Time-box it (a few days at most). Page jump + passage panel is an acceptable, honest fallback.
- **Eval + demo mode + RLS + streaming + Playwright** are each reasonable, but together they are the actual project. Don't add more on top.
- **Local embedding models** (e.g. Transformers.js) fit poorly with Vercel serverless limits. Cut this option; use hosted free-tier embeddings.
- **Prisma:** cut from the user-facing data path, as explained in the security section.

**Cut or defer:** OAuth providers, demo uploads, multi-turn, hybrid search, reranking, DOCX, admin dashboard.

### Suggested build order (de-risk first)

1. Provider spike (risk 1) and highlight spike (risk 2)
2. Schema + RLS + isolation tests (risk 5)
3. Ingestion pipeline with status tracking
4. Retrieval + refusal threshold, calibrated with the eval questions (risk 3)
5. Streaming answer + citation validation
6. PDF viewer + citations UI
7. Limits, CAPTCHA, demo mode (risk 4)
8. Playwright flows, accessibility pass, eval write-up, README with architecture diagram and a short "decisions and tradeoffs" section

---

## 7. Assumptions

- **Embeddings/LLM:** Gemini free tier as default, behind a provider abstraction; Groq or OpenRouter free models as fallback. Verify availability from Nigeria first (risk 1).
- **Ingestion:** runs in a Next.js route or Supabase Edge Function with status tracking. No separate queue infrastructure.
- **Auth:** Supabase Auth with email + anonymous sign-in for MVP; OAuth later.
- **Retrieval:** pgvector with HNSW index and cosine similarity, plus a similarity-threshold cutoff for the "I couldn't find that" behavior.
- **PDF viewing:** `react-pdf` / PDF.js, highlighting via text-layer matching.
- **Languages:** English only.
- **Rate limits:** enforced server-side in Postgres (usage table), never client-side.
- **Testing:** Playwright for E2E, Vitest for unit tests on chunking and citation logic.
- **No** payments, teams, or sharing between users.

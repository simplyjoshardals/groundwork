# Spike 0.5: AI provider access and limits

**Status (2026-10-31): evidence in progress. Task 0.5 is NOT complete and no final provider or model decision has been made.**
Verified so far (**RUN**, result files reviewed): `gemini-embedding-001` embedded 100 synthetic chunks at 768 dimensions in a paced local run (5/5 known-answer retrieval) and 30 chunks through the deployed Vercel route, with zero HTTP 429s in both. An earlier unpaced run did hit 429s. Four streaming result files (Gemini `gemini-3.5-flash-lite` and Groq `openai/gpt-oss-120b`, local and deployed, one RAG-style prompt each) were also reviewed: all four completed with HTTP 200 and a correct answer. **Streaming is not shown to be incremental or production-ready:** there is no evidence of whole-response buffering in these samples, but each stream was short (under about 2 s), so incremental delivery is not proven, and the five-second streaming test of Task 0.8 is outstanding.
**Provisional LLM roles (not a final decision): Gemini primary, Groq fallback** (section 5.4). Embeddings have no fallback.
**Provisional embedding choice (not a final decision): `gemini-embedding-2` at 768 dimensions, no additional L2 normalization** (section 5.6). Its figures are **USER-verified**: Joshua checked both result JSONs against this report using another tool; they were not independently inspected here.
**Ready for Slice 1: NO.** Open: the stability status of `gemini-embedding-2`, a deployed `gemini-embedding-2` test, quota accounting, ingest performance against the 60 s target, retrieval quality beyond this small synthetic set, multi-second streaming through Vercel (Task 0.8), Groq output normalization, provider limits and terms, and the final provider and model choices.

## How to read this document

Every statement carries one of these tags. Nothing is "passed" unless it is tagged **RUN**.

| Tag       | Meaning                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RUN**   | Executed against the real provider (by Joshua, from his machine or from Vercel). The saved result file was reviewed and the numbers below were recomputed from it. |
| **USER**  | Reported by Joshua (a summary or a pass/fail). The raw result file has not been reviewed, so details are missing.                                                  |
| **CONS**  | Read by Joshua from his own provider console on the date shown. Not tested by us.                                                                                  |
| **DOC**   | Read from an official page (URL and date given). Not yet confirmed by a request.                                                                                   |
| **INFER** | Inference from RUN, USER or CONS numbers. Consistent with the evidence but **not proven**.                                                                         |
| **MOCK**  | Checked only against a local fake server. Proves our code, not the provider.                                                                                       |
| **OPEN**  | Unknown. Needs a test or an answer.                                                                                                                                |

## 1. What was built

- `spikes/provider/` holds fetch-based clients (no vendor SDKs), synthetic test data, benchmarks, and the CLI runner.
- `app/api/spike/route.ts` is a temporary, token-protected route for the deployed tests. It returns measurements only (never vectors, keys, or raw headers) and is disabled (404) unless `SPIKE_TOKEN` is set.
- Only these response headers are ever printed or saved: `retry-after`, `content-type`, `x-vercel-id`, and `x-ratelimit-*`.
- Test text is synthetic (a fictional "Brindlemoor handbook"), so no private content reaches a free tier that may use it to improve products.

### Harness verification (MOCK, not provider evidence)

Run on 2026-10-30 in a scratch copy, with no real keys:

- `lint`, `typecheck`, `next build` pass; 16 unit tests pass (SSE parsing, header whitelist, retry and give-up logic, input validation, synthetic data).
- The CLI and the production route were driven against a fake Gemini/Groq server: model discovery, 768-dim probe, 429 then retry, 400 fallback when an API rejects `taskType`, give-up on a long `retry-after`, 100-chunk batching, SSE with CRLF, Groq reasoning deltas and `[DONE]`, and incremental delivery through `next start`.
- A scan found no key, token, `set-cookie`, or `?key=` URL in saved results or logs. The two embedding result files and the four streaming result files reviewed on 2026-10-31 were scanned the same way and are clean.

### Known harness gaps (OPEN, no code changed; fixes need approval)

- The `embed-100` output does not record the individual attempts of the final query-embedding call, only aggregate counts, so the details of the earlier 429s (status per attempt, `Retry-After`, `retryDelay`) were lost.
- The error message is cut to 300 characters and Google's `error.details` (which may name the exceeded quota) is not kept, apart from `retryDelay`.
- `completed` is computed before the query step, so a run can report `completed: true` and a `failure` at the same time.
- Retries are not paced against a per-minute budget and wait at most a provider-hinted time, which is shorter than a one-minute window.
- **`containsExpected` is whitespace-fragile (RUN, found 2026-10-31).** The check lower-cases the answer and looks for the exact substring `14 weeks` with an ordinary space (`benchmarks.ts`). The local Groq answer contained U+202F (narrow no-break space) between `14` and `weeks`, so the flag came back `false` although the answer was correct. The character codes were read from the saved JSON; the other three runs used an ordinary space and passed. With whitespace normalized, all four match. Until the check normalizes whitespace, a `false` from this flag must be read by hand and a `true` only means the plain-space form appeared.
- **Citation markers differ by provider, and nothing normalizes them (RUN, found 2026-10-31).** The prompt asks for markers like `[3]`. Gemini answered `[3]` in both runs. Groq answered `【3】` (full-width brackets) in both runs, and in the deployed run also used markdown bold (`**14 weeks**`). Any code that finds or validates citations (Slice 2) must normalize bracket style, markdown and special spaces before matching, otherwise a Groq fallback answer's citations would not be recognized. This is a requirement for the Groq adapter or the citation validator; no code has been changed. Two samples from one model: whether Groq always does this is unknown.

## 2. How to rerun (Windows, PowerShell, from the repo root)

Put `GEMINI_API_KEY`, `GROQ_API_KEY`, `SPIKE_TOKEN` (and optionally `SPIKE_BASE_URL`) in `.env.local`. Never paste them anywhere else.

```powershell
yarn install
yarn spike:provider --task=discover
yarn spike:provider --task=embed-probe --model=<embedding id from discover>
yarn spike:provider --task=embed-100 --model=<id> --batch=10 --delay-ms=10000
yarn spike:provider --task=stream --provider=gemini --model=<id> --prompt=short
yarn spike:provider --task=stream --provider=gemini --model=<id> --prompt=rag
yarn spike:provider --task=stream --provider=groq --model=openai/gpt-oss-120b --prompt=rag
```

Deployed (after pushing, with the three env vars set in Vercel): add `--target=deployed --base-url=https://groundwork-livid-iota.vercel.app` to the same commands (`discover` is local only). The deployed embedding run must be smaller because the route stops starting new batches after 40 s: `--task=embed-100 --model=<id> --chunks=30 --batch=10 --delay-ms=8000`. The retrieval check needs at least 89 chunks, so it is skipped there.

**Pace embedding runs and wait at least 2 minutes between them.** A single unpaced 100-chunk run (batches of 20, no delay) produced 429s on 2026-10-31. The two paced runs below did not. Whether the limit that was hit is requests per minute, counted per text, is INFER only (section 5, "What the comparison does and does not show"). Results are saved under `spikes/provider/results/` (git-ignored).

## 3. Limits as shown in the consoles (CONS, 2026-10-30, not tested)

**Google AI Studio (free tier):**

| Model (as named in the console)      | RPM | TPM  | RPD   |
| ------------------------------------ | --- | ---- | ----- |
| Gemini Embedding 2                   | 100 | 30K  | 1K    |
| Gemini Embedding 1                   | 100 | 30K  | 1K    |
| Gemini 3.1 Flash Lite                | 15  | 250K | 500   |
| Gemini 3.5 Flash Lite                | 15  | 250K | 500   |
| Gemini 3.8 Flash, 3.6 Flash, 3 Flash | 5   | 250K | 20    |
| Gemini 2.5 Flash                     | 5   | 250K | 20    |
| Gemini 2.5 Flash Lite                | 10  | 250K | 20    |
| Gemma 4 26B / 31B                    | 30  | 16K  | 14.4K |
| Gemini 2.5 Pro, 3.1 Pro              | 0   | 0    | 0     |

**Groq (Developer plan base limits, organization level):**

| Model               | RPM | RPD | TPM | TPD  |
| ------------------- | --- | --- | --- | ---- |
| openai/gpt-oss-120b | 30  | 1K  | 8K  | 200K |
| openai/gpt-oss-20b  | 30  | 1K  | 8K  | 200K |
| qwen/qwen3.8-27b    | 30  | 1K  | 8K  | 200K |

Consequences (OPEN unless marked; the Groq and embedding items were corrected on 2026-10-31):

- The Gemini Flash models at 20 RPD are too small for a public demo. Flash Lite (500 RPD) and Gemma 4 (14.4K RPD, 16K TPM) are the realistic Gemini LLM candidates. `gemini-3.5-flash-lite` streamed successfully on this key (section 5.4).
- **Corrected:** the first estimate for Groq (two 3K-token prompts per minute, 60-70 questions per day) assumed 3K tokens. The measured use is about 2.07K tokens per question (RUN, section 5.4): about 3 questions per minute, and about 97 per day against the 200K daily cap (CONS). Still fallback only.
- The Gemini embedding console showed 1 request and 13 tokens, and Gemini 3.8 Flash showed 1 request, before this spike's tests (earlier manual use). Subtract this from any "before" reading.
- **Corrected:** an earlier version of this document said embedding throughput is limited by 30K TPM. The 2026-10-31 evidence does not support that: TPM peaked at 15.41K of 30K when the 429s occurred, while RPM showed 100/100 (section 5). The request-per-minute limit looks like the tighter one (INFER). Per-text counting, if real, also means a 100-chunk ingest uses the entire per-minute allowance.

## 4. Terms, regions, and signup

| Item                            | Finding                                                                                                                                                                                                                                                                                                                                                          | Tag              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Signup from Nigeria             | Google AI Studio and Groq accounts and API keys were created without a VPN and without being blocked.                                                                                                                                                                                                                                                            | USER, 2026-10-30 |
| Card requirement                | Not confirmed for either provider for ongoing use.                                                                                                                                                                                                                                                                                                               | OPEN             |
| Gemini API available in Nigeria | Nigeria is listed in the available-regions page ("Last updated 2026-10-22 UTC"). The page says nothing about free tier by region. https://ai.google.dev/gemini-api/docs/available-regions                                                                                                                                                                        | DOC              |
| Gemini free-tier data use       | "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop"; "human reviewers may read, annotate, and process your API input and output."; "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Page "Last updated 2026-04-28 UTC". https://ai.google.dev/gemini/terms | DOC              |
| Gemini EEA restriction          | "You may use only Paid Services when making API Clients available to users in the European Economic Area". Our app is a client other people may use, so EEA/UK/CH visitors are a compliance risk on the free tier.                                                                                                                                               | DOC              |
| Groq retention                  | "By default, Groq does not retain customer data for inference requests." Inputs/outputs may be logged temporarily for troubleshooting or abuse, up to 30 days. Zero Data Retention can be enabled in settings. Page shows no date. https://console.groq.com/docs/your-data                                                                                       | DOC              |
| Groq training use               | The page does not say whether data is used for training.                                                                                                                                                                                                                                                                                                         | OPEN             |
| Groq rate-limit headers         | Documented: `x-ratelimit-limit-requests` and `-remaining-requests` / `-reset-requests` refer to requests per day; `-limit-tokens` / `-remaining-tokens` / `-reset-tokens` refer to tokens per minute; `retry-after` (seconds) is set only on a 429. Limits apply per organization. https://console.groq.com/docs/rate-limits                                     | DOC              |

Implication already clear from DOC: the free Gemini tier may use and human-review submitted text. This matches the existing mitigation in ARCHITECTURE (demo uses only public sample documents, UI warns real users). It does not make real user uploads safe.

## 5. Embedding model facts and test results

### Documented (DOC; https://ai.google.dev/gemini-api/docs/embeddings, read 2026-10-30)

|                                 | `gemini-embedding-2`                                                     | `gemini-embedding-001`                          |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Default dimensions              | 3072                                                                     | 3072                                            |
| `output_dimensionality`         | 128-3072, 768 recommended                                                | 128-3072, 768 recommended                       |
| Truncated dimensions normalized | Yes, automatically                                                       | **No, must normalize ourselves**                |
| `taskType` field                | **Not supported**; use text prefixes                                     | Supported                                       |
| Query / document format         | `task: search result \| query: {text}` and `title: none \| text: {text}` | `taskType` RETRIEVAL_QUERY / RETRIEVAL_DOCUMENT |
| Max input tokens                | 8192                                                                     | 2048                                            |

Our adapter follows these rules by model id and falls back to raw text if an API answers 400. The console model names ("Gemini Embedding 2" / "Gemini Embedding 1") are assumed to map to these ids. `gemini-embedding-001` discovery succeeded (USER); `gemini-embedding-2` accepted requests on this key (USER-verified, section 5.6); the discover output has not been reviewed. Whether it is stable or preview is **OPEN**: the DOC table does not say.

### 5.1 Local paced run (RUN, 2026-10-31)

File: `spikes/provider/results/2026-10-31T11-15-26-256Z-embed-100-local-gemini-embedding-001.json` (started 11:13:37Z, Node v22.18.0). Command: `--task=embed-100 --model=gemini-embedding-001 --batch=10 --delay-ms=10000`.

| Field                  | Result                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model, input style     | `gemini-embedding-001`, `taskType` field (no fallback needed)                                                                                                                    |
| Chunks embedded        | 100 / 100 (10 batches of 10)                                                                                                                                                     |
| HTTP requests          | 11 = 10 document batches + 1 query call. Every batch: 1 attempt, status 200                                                                                                      |
| 429s / retryable       | 0 / 0                                                                                                                                                                            |
| Dimensions             | 768 for every vector; all values finite                                                                                                                                          |
| Vector norms           | min 0.5842, max 0.5904, mean 0.5879 (**not unit length**)                                                                                                                        |
| Per-batch latency      | 1,504-2,172 ms (mean 1,795 ms), measured from Joshua's machine                                                                                                                   |
| Total time             | 109.03 s = 90.0 s of planned waiting + 17.95 s inside the 10 batch calls + about 1.1 s for the rest (the 6-text query call and overhead; derived by subtraction)                 |
| Rate of sending        | About 55 texts per minute on average (100 texts in 109 s). By timing arithmetic, no 60-second window held more than about 66 texts including the 6 queries (INFER, not observed) |
| Estimated input size   | 18,921 tokens (characters / 4, an estimate)                                                                                                                                      |
| Known-answer retrieval | 5 / 5 correct (table below)                                                                                                                                                      |
| Failure                | none; `completed: true`                                                                                                                                                          |

| Question (abridged)           | Expected chunk | Top-1 chunk | Top-1 similarity | Top-2 similarity | Margin |
| ----------------------------- | -------------- | ----------- | ---------------- | ---------------- | ------ |
| Weeks of paid parental leave  | 7              | 7           | 0.6876           | 0.6042           | 0.0834 |
| How often laptops replaced    | 23             | 23          | 0.6620           | 0.6069           | 0.0551 |
| Itemised receipt amount       | 41             | 41          | 0.6460           | 0.5898           | 0.0562 |
| Fire drill gathering place    | 66             | 66          | 0.6784           | 0.5917           | 0.0867 |
| Help desk call hours          | 88             | 88          | 0.7030           | 0.6245           | 0.0785 |
| Goats on the roof (no answer) | none           | 33          | 0.6776           | 0.6766           | 0.0010 |

Observations (single run, 100 synthetic chunks, 6 questions; not a conclusion):

- The cosine function used here divides by vector length, so the 5/5 result does not depend on the vectors being unit length.
- The unanswerable question's best similarity (0.6776) is **higher than two of the five answerable questions' best similarities** (0.6460 and 0.6620). A single similarity cutoff would not have separated them in this sample. The gap between first and second place did separate them (0.0010 versus 0.055 or more). This matters for the refusal gate in Slice 2 and is **OPEN**; six questions on synthetic text prove nothing about production quality.

### 5.2 Deployed paced run (RUN, 2026-10-31)

File: `spikes/provider/results/2026-10-31T11-18-02-924Z-embed-100-deployed-gemini-embedding-001.json` (started 11:17:43Z, 137 s after the local run ended). Command: `--target=deployed --task=embed-100 --model=gemini-embedding-001 --chunks=30 --batch=10 --delay-ms=8000`.

| Field             | Result                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route response    | HTTP 200; round trip 19,489 ms; server-side 17,633 ms (16,000 ms planned waiting)                                                                                                |
| Chunks embedded   | 30 / 30 (3 batches of 10); `stoppedByBudget: false`                                                                                                                              |
| HTTP requests     | 3, each 1 attempt, status 200; 0 429s; 0 retryable failures                                                                                                                      |
| Dimensions, norms | 768; all finite; norms min 0.5848, max 0.5904, mean 0.5881                                                                                                                       |
| Estimated input   | 5,687 tokens (characters / 4, an estimate)                                                                                                                                       |
| Per-batch latency | 531-553 ms, measured inside the Vercel function (about a third of the 1.5-2.2 s seen from Joshua's machine)                                                                      |
| Where it ran      | `x-vercel-id: fra1::iad1::…`. Assuming Vercel's documented `edge::function::id` layout (not verified here), the function ran in `iad1` (Washington, D.C.), entered via Frankfurt |
| Retrieval         | Not run (needs at least 89 chunks)                                                                                                                                               |
| Failure           | none                                                                                                                                                                             |

Only 30 of 100 chunks were embedded on the deployed route. The deployed 100-chunk case is **not** tested (the route's 40 s budget cannot fit a paced 100-chunk run).

### 5.3 Earlier unpaced run (USER summary + CONS console; raw JSON not reviewed)

Reported by Joshua on 2026-10-31, with batches of 20 and no delay, `gemini-embedding-001`:

- 100 / 100 chunks embedded in 5 batches; about 42.4 s total; 8 HTTP requests; **3 retryable HTTP 429s**; the final query-embedding call failed with a quota-exceeded error.
- Console read afterwards (CONS): RPM **100 / 100**, TPM **15.41K / 30K**, RPD **104 / 1K** (the model row is assumed to be Embedding 1).

Because the output did not keep the query call's attempts, the exact 429 body, `Retry-After` value and quota name are **not recorded** (see harness gaps).

### What the comparison does and does not show

Shown (RUN and USER): with batches of 20 and no pause, the run hit 429s and the query call failed; with batches of 10 and a 10 s pause, a 100-chunk run and its query call completed with no 429s, and a paced 30-chunk run on Vercel also had none. **Pacing appears to avoid the 429s seen in the unpaced run.**

Not shown:

- Which change mattered. Batch size (20 to 10) and the delay (0 to 10 s) changed together.
- Each configuration was run once. No repeat, no run at the limit's edge.
- The exact quota accounting. These numbers are consistent with a requests-per-minute limit of 100 that counts each text in a batch (INFER, **not proven**): the console showed RPM 100/100 although only about 8 HTTP requests were sent; 5 batches of 20 texts is exactly 100; RPD 104 equals 2 probe texts + 100 chunk texts + 2 deployed-probe texts; and TPM was only 15.41K of 30K. These numbers could have other explanations (for example another model row, or earlier usage).
- That rejected calls do not count toward the quota (RPD suggests so; the RPM display stops at its limit).
- A before/after console reading for the paced runs was **not recorded**. It would test the hypothesis: if each text counts, the paced local run should add about 106 to RPD and show an RPM peak of about 60-66; if each request counts, about 11 and 11.

### 5.4 Streaming results (RUN, 2026-10-31)

Four result files, one run each, with the same RAG-style prompt: 12 numbered passages (9,347 characters), the answer passage third, a question about parental leave, up to 600 output tokens. Files in `spikes/provider/results/`:

- `2026-10-31T09-38-22-445Z-stream-local-gemini-3.5-flash-lite.json`
- `2026-10-31T09-39-59-970Z-stream-local-openai_gpt-oss-120b.json`
- `2026-10-31T11-02-02-546Z-stream-deployed-gemini-3.5-flash-lite.json`
- `2026-10-31T11-02-38-812Z-stream-deployed-openai_gpt-oss-120b.json`

Three kinds of timing are kept apart because they measure different things:

- **Local:** Joshua's script calling the provider directly (Node v22.18.0). Includes DNS, TLS and the network path from Nigeria.
- **Deployed, server:** measured inside the Vercel function around its provider call (the route's `summary` line). Excludes the path to Joshua's machine.
- **Deployed, client:** measured by Joshua's script receiving the route's response. Adds the Nigeria-to-Vercel path, connection setup, any function start-up and route processing.

**Local results (script talking directly to the provider):**

| Measure                             | Gemini `gemini-3.5-flash-lite`           | Groq `openai/gpt-oss-120b`                                                  |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Started (UTC)                       | 09:38:20.427                             | 09:39:58.556                                                                |
| Provider HTTP status; finish        | 200; `STOP`; no error                    | 200; `stop`; no error                                                       |
| Response headers received           | 1,890 ms                                 | 1,133 ms                                                                    |
| First reasoning event               | none                                     | 1,214 ms                                                                    |
| **First text token**                | **1,895 ms**                             | **1,400 ms**                                                                |
| **Total stream time**               | **2,013 ms** (script wall time 2,016 ms) | **1,406 ms** (script wall time 1,409 ms)                                    |
| First text token to end             | 118 ms                                   | 6 ms                                                                        |
| Text events (characters)            | 3 (78)                                   | 15 (59)                                                                     |
| Reasoning events (characters)       | 0                                        | 65 (283)                                                                    |
| Largest gap between text events     | 109 ms                                   | 1 ms                                                                        |
| Tokens: prompt + completion = total | 1,945 + 18 = 1,963                       | 1,981 + 90 = 2,071                                                          |
| `containsExpected` ("14 weeks")     | true                                     | **false** (false negative, see "Answer content")                            |
| Answer correct; citation marker     | yes; `[3]`                               | yes; `【3】`                                                                |
| Rate-limit headers kept             | none                                     | limit 8,000 tokens and 1,000 requests; remaining 5,699 tokens, 999 requests |

**Deployed results (server = inside the Vercel function, client = Joshua's script):**

| Measure                                 | Gemini: server                 | Gemini: client          | Groq: server                                                                | Groq: client               |
| --------------------------------------- | ------------------------------ | ----------------------- | --------------------------------------------------------------------------- | -------------------------- |
| Started (UTC)                           | not recorded                   | 11:02:00.761            | not recorded                                                                | 11:02:37.354               |
| Status; finish                          | provider 200; `STOP`; no error | route 200               | provider 200; `stop`; no error                                              | route 200                  |
| Provider response headers               | 642 ms                         | not applicable          | 309 ms                                                                      | not applicable             |
| First byte at client                    | not applicable                 | 1,731 ms                | not applicable                                                              | 1,276 ms (before any text) |
| First reasoning event                   | none                           | not separately recorded | 396 ms                                                                      | not separately recorded    |
| **First text token**                    | **643 ms**                     | **1,731 ms**            | **540 ms**                                                                  | **1,417 ms**               |
| Last text delta                         | not recorded                   | 1,780 ms                | not recorded                                                                | 1,437 ms                   |
| **Total**                               | **724 ms**                     | **1,781 ms**            | **573 ms**                                                                  | **1,452 ms**               |
| Client minus server, first text / total | not applicable                 | +1,088 / +1,057 ms      | not applicable                                                              | +877 / +879 ms             |
| Text events (characters) / deltas       | 3 (78)                         | 3 deltas                | 15 (63)                                                                     | 15 deltas                  |
| Reasoning events (characters)           | 0                              | not recorded            | 62 (264)                                                                    | not recorded               |
| Network reads (containing text)         | not applicable                 | 3 (3)                   | not applicable                                                              | 18 (4)                     |
| Largest gap / text spread               | gap 75 ms                      | spread 49 ms            | gap 3 ms                                                                    | spread 20 ms               |
| Tokens: prompt + completion = total     | 1,945 + 18 = 1,963             | not recorded            | 1,981 + 87 = 2,068                                                          | not recorded               |
| `containsExpected`                      | true                           | not applicable          | true                                                                        | not applicable             |
| Answer correct; citation marker         | yes; `[3]`                     | not applicable          | yes; `【3】`, markdown bold                                                 | not applicable             |
| Rate-limit headers kept                 | none                           | not applicable          | limit 8,000 tokens and 1,000 requests; remaining 5,709 tokens, 999 requests | not applicable             |

Both deployed runs carried `x-vercel-id: fra1::iad1::…` (different ids). Under the assumption in section 5.2, the function ran in `iad1`.

**Reading the timings**

- Local Gemini: almost all of the time to first text (1,895 ms) was waiting for the response headers (1,890 ms); the three text events then arrived within 118 ms. Local Groq: reasoning started at 1,214 ms and the whole visible answer arrived within 6 ms of the first text token.
- Seen from inside Vercel the provider responded faster than seen from Joshua's machine: headers at 642 ms against 1,890 ms (Gemini) and 309 ms against 1,133 ms (Groq). The cause is not isolated (network distance and fresh connection setup are likely; INFER).
- Client minus server was +1,088 ms (first text) and +1,057 ms (total) for Gemini, and +877 ms and +879 ms for Groq: a roughly constant 0.9-1.1 s outside the provider call. These files cannot split it into network path, connection setup and function start-up (OPEN).
- Net effect from Joshua's location: first text at 1,731 ms (Gemini) and 1,417 ms (Groq) through the deployed route, against 1,895 ms and 1,400 ms calling the providers directly. The route did not improve first-text latency here. One sample each; no repeat.
- Groq's provider-side total was shorter (573 ms against 724 ms), but a gap of about 150 ms in single samples is not evidence of a speed difference.

**Incremental delivery: what is and is not shown**

- Deployed Gemini: the 3 text deltas arrived in 3 separate network reads over 49 ms. They were not merged into one read.
- Deployed Groq: the first byte arrived at 1,276 ms, 141 ms before the first text delta (1,417 ms) and 176 ms before the end (1,452 ms). The server saw 177 ms between its first reasoning event (396 ms) and the end (573 ms). The span between first byte and end was therefore preserved through Vercel, which argues against whole-response buffering. The 15 text deltas arrived in 4 network reads (some coalescing) over 20 ms.
- Local: Gemini sent 3 text events (largest gap 109 ms). Groq sent its 15 text events within 6 ms, so the visible answer came essentially as one burst after the reasoning.
- **Conclusion (qualified):** there is no evidence of whole-response buffering in these samples. **Incremental delivery is not proven.** Each stream took under about 2 s of wall time and 20-176 ms between first and last byte at the client; the harness's own heuristic reported "unclear" for both deployed runs; and a short answer would be unaffected by a normal-sized proxy buffer. The multi-second test (an event every 300 ms for 5 s, Task 0.8) is **outstanding**, and streaming must not be called production-ready on this evidence.

**Answer content**

- All four answers state 14 weeks and cite passage 3, which is the passage that holds the fact. Content is correct in 4 of 4, for one question.
- `containsExpected` was `false` for local Groq only because that answer has U+202F (narrow no-break space) between "14" and "weeks" and the check needs an ordinary space (section 1, harness gaps). It is a false negative, not a wrong answer.
- Citation markers: Gemini `[3]` in both runs; Groq `【3】` in both runs, with markdown bold in the deployed run (section 1, harness gaps).
- Reasoning: Groq sent 65 (local) and 62 (deployed) reasoning events (283 and 264 characters; the content is not kept by the harness) before the answer. Its completion tokens (90 and 87) include them. Whether a reasoning-effort setting was sent is not recorded in the result files. Behaviour on harder questions is unknown.

**Groq limits observed in response headers (RUN)**

- Both Groq runs returned `x-ratelimit-limit-tokens: 8000` and `x-ratelimit-limit-requests: 1000`, matching the console figures (CONS) for tokens per minute and requests per day. The 200K tokens-per-day cap is not in the headers and remains CONS.
- After each call 5,699 and 5,709 tokens remained, so 2,301 and 2,291 were deducted. The reset times in the headers (17.257 s and 17.182 s) match a bucket that refills continuously at 8,000 tokens per minute (2,301 x 60 / 8,000 = 17.258 s). That is an arithmetic match (INFER), not documented behaviour.
- At about 2.3K deducted per question, that is roughly 3 questions per minute. At 2,071 tokens per question, the 200K daily cap (CONS) is about 97 questions per day.
- Gemini's responses carried no rate-limit headers in these files, so remaining Gemini quota is visible only in the console.

**Provisional LLM roles (not a final decision)**

- **Provisional primary: Gemini `gemini-3.5-flash-lite`.** Both providers streamed through the same adapter interface. Gemini followed the `[n]` citation format, and its daily headroom is larger: 500 requests per day (console, CONS) against about 97 questions per day on Groq by token budget. The placeholder global cap of 200 questions per day in `DATA_MODEL.md` fits within Gemini's 500 but not within Groq's roughly 97.
- **Provisional fallback: Groq `openai/gpt-oss-120b`.** It answered correctly on the same prompt and works through the same interface. But it allows only about 3 questions per minute and about 97 per day, its reasoning tokens count toward the limits, and its output needs normalization (citation brackets, markdown, special spaces) before any citation validation.
- Embeddings have no fallback (ARCHITECTURE section 3.8), so a Google outage or key problem would hit embeddings and the primary LLM together. Only the LLM side can fall back to Groq.
- **Not shown:** answer quality beyond one question; behaviour at the limits (no LLM-side 429 observed); concurrent requests; a mid-stream failure and a switch to the fallback; Gemma 4 and qwen; the reasoning-token cost on harder prompts; and what Gemini's free-tier data-use terms (section 4) mean for real uploads. The short-prompt runs were not among the files reviewed.

### 5.6 Embedding comparison: `gemini-embedding-2` against `gemini-embedding-001` (USER-verified, 2026-10-31)

**Evidence label: USER-verified.** The two `gemini-embedding-2` result JSONs (probe and 100-chunk local run) were checked by Joshua against this report using another tool. They were **not** independently inspected here, so these figures are not tagged RUN. The `gemini-embedding-001` figures are RUN (sections 5.1 and 5.2).

| Measure                                         | `gemini-embedding-2`                                                                             | `gemini-embedding-001`                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Probe                                           | native 3072; reduced 768; norm 1 for both                                                        | native 3072; reduced 768; reduced norm about 0.5848                            |
| Prompt style                                    | `instruction-prefix` accepted, no fallback                                                       | `task-type`                                                                    |
| 100 chunks, local, batch 10, 10 s delay         | 100/100; 11 HTTP requests; 0 retries; 0 x 429; **108.4 s** (includes 90 s of deliberate waiting) | 100/100; 11 requests; 0 x 429; **109 s** (includes 90 s of deliberate waiting) |
| Known-answer retrieval (5 answerable questions) | 5/5                                                                                              | 5/5                                                                            |
| Mean vector norm                                | 1.0                                                                                              | 0.5879                                                                         |
| Unanswerable question                           | top-1 0.6689, top-2 0.6678                                                                       | top-1 0.6776 (its margin over the next answerable top-1 was 0.001)             |

**Reading the comparison**

- Same synthetic chunks, same questions and same pacing. The prompt style differs between the two models, so a difference cannot be attributed to the model alone. One synthetic set; no real documents.
- **Ingest time.** The 108.4 s includes 90 s of intentional waiting (9 gaps of 10 s); the 11 requests themselves took about 18 s in `-001`'s run, and the equivalent split for `-2` is not separately recorded. The pace was chosen to be safe, not tuned. Ingest performance against the 60 s target in REQUIREMENTS.md is still **OPEN**.
- **Unanswerable question.** Its top-1 and top-2 for `-2` are 0.0011 apart. **Do not derive a refusal threshold from these scores.** One question is not enough for a threshold.
- **Normalization (INFER).** `-2` returned unit-length vectors at 768 dimensions (mean norm 1.0), so no additional L2 step is proposed. This matches the documentation table in section 5 (truncated dimensions are normalized automatically for `-2`). Search uses cosine distance, which ignores vector length, so normalization would not change cosine ranking or similarity values either way. That reasoning is not a measurement.
- **Adapter requirement.** The `gemini-embedding-2` adapter must apply the document prefix (`title: none | text: {text}`) at ingest and the query prefix (`task: search result | query: {text}`) at search time. The `taskType` field is not used for this model. Forgetting the query prefix would silently change the vectors being compared. The `embedding_model` stored per chunk must be the exact id.

**Still open for `gemini-embedding-2`**

- Stability status (stable or preview). Not stated in the documentation we have recorded, so decision rule 3 stays open.
- A deployed test through the Vercel route. None has been run for `-2`.
- Quota accounting. No console before/after reading around the `-2` run is recorded. Console snapshots on 2026-10-31 (CONS, single readings, not proof): Embedding 1 RPM 100/100, TPM 15.41K/30K, RPD 240/1K; Embedding 2 RPM 1/100, TPM 13/30K, RPD 1/1K. The `-001` daily count rose from 104 to 240 (136), which equals the 106 local plus 30 deployed texts sent since (INFER: consistent with per-text daily counting, not proven).
- 429 behaviour for `-2` (none occurred), and ingest performance (above).

### 5.5 Test log (updated 2026-10-31)

| #   | Test                                                                                      | Result                                                                                                                                                                                                                                                      | Tag                                |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Model discovery: exact ids visible to each key                                            | `gemini-embedding-001` discovery succeeded. Full lists (including `gemini-embedding-2`, Flash Lite, Groq models) not reviewed                                                                                                                               | USER / OPEN                        |
| 2   | 768 dimensions probe (`gemini-embedding-001`)                                             | Local: 2 requests HTTP 200; native 3072; reduced 768; reduced norm about 0.5848. Deployed probe: HTTP 200. Raw files not reviewed                                                                                                                           | USER                               |
| 2b  | 768 dimensions in the full runs                                                           | `-001`: 768 for all 130 vectors in 5.1 and 5.2; finite; not unit length (norms 0.5842-0.5904). `-2`: 768-dimension vectors reported with mean norm 1.0 (USER-verified, section 5.6)                                                                         | RUN (`-001`); USER-verified (`-2`) |
| 3   | 100 chunks, paced, local, with retrieval                                                  | 100/100, 0 429s, 109 s, retrieval 5/5 (section 5.1)                                                                                                                                                                                                         | RUN                                |
| 3a  | 100 chunks, unpaced (batches of 20), local                                                | 100/100 embedded, 3 429s, query call failed (section 5.3)                                                                                                                                                                                                   | USER + CONS                        |
| 4   | Same, through the deployed route                                                          | Partial: 30/30 chunks, 0 429s, no retrieval (section 5.2). 100-chunk deployed run not done                                                                                                                                                                  | RUN (partial)                      |
| 5   | Console delta for one run (does a batch count as 1 request or N?)                         | Not recorded for the paced runs. Unpaced numbers are consistent with N (INFER)                                                                                                                                                                              | OPEN / INFER                       |
| 6   | Gemini streamed answer (`gemini-3.5-flash-lite`), RAG prompt, local                       | 200, `STOP`; first text 1,895 ms; total 2,013 ms; 3 text events; correct answer with `[3]`. The short-prompt run was not reviewed                                                                                                                           | RUN                                |
| 7   | Gemini streamed answer, deployed                                                          | Route 200. Server: first text 643 ms, total 724 ms. Client: first text 1,731 ms, total 1,781 ms; 3 deltas in 3 reads over 49 ms; correct answer. Incremental delivery not proven                                                                            | RUN                                |
| 8   | Gemma 4 one streamed RAG answer                                                           | Not reported                                                                                                                                                                                                                                                | not run / unknown                  |
| 9   | Groq streamed answer (`openai/gpt-oss-120b`), RAG prompt, local                           | 200, `stop`; first reasoning 1,214 ms; first text 1,400 ms; total 1,406 ms; 15 text + 65 reasoning events; correct answer with `【3】`; `containsExpected` false negative (U+202F). The short-prompt run was not reviewed                                   | RUN                                |
| 10  | Groq deployed                                                                             | Route 200. Server: first text 540 ms, total 573 ms. Client: first text 1,417 ms, total 1,452 ms; 15 deltas in 4 of 18 reads over 20 ms; correct answer with `【3】` and markdown bold                                                                       | RUN                                |
| 11  | Groq qwen3.8-27b one RAG answer                                                           | Not reported                                                                                                                                                                                                                                                | not run / unknown                  |
| 12  | Provider switch: same prompt through both adapters; reasoning field, token limits, errors | Partly written up (section 5.4): the same interface served both providers. Differences seen: reasoning events, citation brackets, markdown, U+202F, token limits from headers. Error shapes not compared (no errors occurred); mid-stream failover untested | RUN (partial)                      |
| 13  | HTTP 429 behaviour                                                                        | Observed once on Gemini embeddings (row 3a), without per-attempt detail. None in the four streaming runs. LLM-side and Groq 429 handling not observed; no deliberate probe done                                                                             | USER + RUN (partial)               |
| 14  | Multi-second streaming through Vercel (an event every 300 ms for 5 s; Task 0.8)           | Not run. Required before streaming is called production-ready                                                                                                                                                                                               | OPEN                               |
| 15  | `gemini-embedding-2` probe                                                                | Native 3072; reduced 768; norm 1 for both; `instruction-prefix` accepted with no fallback                                                                                                                                                                   | USER-verified                      |
| 16  | `gemini-embedding-2`, 100 chunks, paced local run (batch 10, 10 s delay), with retrieval  | 100/100; 11 HTTP requests; 0 retries and 0 x 429; 108.4 s including 90 s of waiting; retrieval 5/5; mean norm 1.0; unanswerable top-1 0.6689, top-2 0.6678 (no threshold inferred)                                                                          | USER-verified                      |
| 17  | `gemini-embedding-2` through the deployed route; console before/after reading             | Not run / not recorded                                                                                                                                                                                                                                      | OPEN                               |

### Measurements to record per test

Model id; date; HTTP statuses; per-batch and total latency; time to first token; total stream time; whether text arrived incrementally; vector length and norm; finish reason; reported token usage; any `retry-after` and `x-ratelimit-*` values; the console's before/after usage.

## 6. Decision rules and where the evidence stands

The rules were written before the results. Status below covers `gemini-embedding-001` (RUN) and `gemini-embedding-2` (USER-verified, section 5.6); the embedding choice is **provisional, not final**.

| Rule                                                                                                 | Status on 2026-10-31                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 768-length, finite vectors in the probe, a local batch and a deployed batch                       | Met for `-001` (probe is USER-reported; local 100 and deployed 30 are RUN)                                                                                                                                                   |
| 2. Right chunk ranked first for all 5 answerable questions; record the unanswerable question's score | Met locally (5/5) for both `-001` and `-2` (`-2`: USER-verified). Unanswerable top-1 similarity recorded: 0.6776 (see observations). Deployed retrieval not run                                                              |
| 3. Prefer a stable model; if tied, prefer fewer manual steps                                         | **OPEN.** `-2` was tested (USER-verified) and matches `-001` on this synthetic set (768 dimensions, 5/5, no 429s). Whether `-2` is stable or preview is not recorded, so this rule is not closed                             |
| 4. If vectors are not unit length, the adapter must L2-normalize before storing                      | Not triggered for `-2` (mean norm 1.0, USER-verified). Triggered for `-001` (about 0.58-0.59). **Provisional: no additional normalization with `-2`** (section 5.6)                                                          |
| 5. If 768 is impossible or a 30-page ingest is impractical, recommend an alternative                 | 768 works for both models. Ingest time is **OPEN**: 100 chunks took 108.4 s for `-2` and 109 s for `-001` at the pace used, each including 90 s of deliberate waiting, against the 60 s target for a 30-page PDF (see below) |
| 6. `vector(768)` in DATA_MODEL stays unless rule 5 triggers                                          | Unchanged. No migration is written. A provisional `-2` choice does not change the dimension                                                                                                                                  |

Ingest time note (OPEN): the 109 s includes 90 s of deliberate waiting; the batch calls themselves took about 18 s from Joshua's machine. The pace used (about 55 texts per minute) was chosen to be safe, not tuned, and how fast it can safely go is unknown. How many chunks a real 30-page PDF produces is also unknown. Both decide whether the 60 s target is reachable.

## 7. Unresolved questions

- `gemini-embedding-2`: stability status (stable or preview), a deployed test through Vercel, 429 behaviour, and the exact quota accounting (needs a console before/after reading). The embedding choice (`-2`, 768 dimensions, no additional normalization) is **provisional**, not final.
- Normalization: `-2` measured unit length, so none is proposed (INFER, section 5.6). If the model is ever switched back to `-001`, or a different dimension is used, vectors must be re-checked for length and re-embedded.
- The adapter must apply the document prefix at ingest and the query prefix at search time for `gemini-embedding-2` (section 5.6). Not implemented; no code changed.
- Retrieval quality on real documents and questions. The only evidence is 6 questions over synthetic text. Whether a score cutoff or the first-to-second gap should drive refusals is unresolved.
- The exact Gemini quota accounting (per text or per request, and whether rejected calls count). Needs a console before/after reading around a paced run.
- The real 429 response: status per attempt, whether `Retry-After` or a `retryDelay` is sent, and which quota is named. Not recorded for the earlier run.
- 429 behaviour on the LLM side and on Groq (not observed). Deliberate probing needs Joshua's explicit approval.
- Multi-second streaming through Vercel. The four short streams show no evidence of whole-response buffering but do not prove incremental delivery. Task 0.8 is outstanding.
- Not reviewed or not reported: the short-prompt streaming runs, and Gemma 4 and qwen results. Also untested: answer quality beyond one question, LLM-side 429 behaviour, concurrent requests, mid-stream failure and switching to the fallback, and Groq's reasoning-token cost on harder questions.
- Groq output normalization (citation brackets `【n】`, markdown bold, U+202F) is required before citation validation. Not implemented; no code changed.
- Where the 0.9-1.1 s client-minus-server overhead comes from (network path, connection setup, function start-up).
- Gemini as provisional primary and Groq as provisional fallback is **not** a final decision.
- Whether either provider needs a card for ongoing use, and whether Groq trains on free-tier inputs.
- Provider limits and terms can change. Everything tagged CONS or DOC is from 2026-10-30 and is not re-verified here.
- The deployed 100-chunk case, and latency from the Vercel function region (`iad1`, assumed from the header) to each provider. Only one deployed embedding timing exists (531-553 ms per 10-text batch).
- Harness gaps listed in section 1 (no code changed).

## 8. Cleanup when the spike is finished

- Delete `app/api/spike/route.ts`; keep `spikes/provider/` until task 10.x ("Move or delete /spikes").
- Rotate or delete `SPIKE_TOKEN` in Vercel and remove `GEMINI_API_KEY`/`GROQ_API_KEY` from the Vercel project only if they are no longer needed (they will be needed from Slice 1).
- Do not commit `spikes/provider/results/`.

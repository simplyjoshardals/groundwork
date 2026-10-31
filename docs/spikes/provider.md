# Spike 0.5: AI provider access and limits

**Status (2026-10-30): harness built and checked against a fake server only. No real provider test has been run yet.**
**Ready for Slice 1: NO.** The embedding model and dimension are not decided until the rows in section 5 are filled from real runs.

## How to read this document

Every statement carries one of these tags. Nothing is "passed" unless it is tagged **RUN**.

| Tag      | Meaning                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| **RUN**  | Executed against the real provider by us; result recorded below.                  |
| **DOC**  | Read from an official page (URL and date given). Not yet confirmed by a request.  |
| **CONS** | Read by Joshua from his own provider console on the date shown. Not tested by us. |
| **USER** | Reported by Joshua from his own experience.                                       |
| **MOCK** | Checked only against a local fake server. Proves our code, not the provider.      |
| **OPEN** | Unknown. Needs a test or an answer.                                               |

## 1. What was built

- `spikes/provider/` holds fetch-based clients (no vendor SDKs), synthetic test data, benchmarks, and the CLI runner.
- `app/api/spike/route.ts` is a temporary, token-protected route for the deployed tests. It returns measurements only (never vectors, keys, or raw headers) and is disabled (404) unless `SPIKE_TOKEN` is set.
- Only these response headers are ever printed or saved: `retry-after`, `content-type`, `x-vercel-id`, and `x-ratelimit-*`.
- Test text is synthetic (a fictional "Brindlemoor handbook"), so no private content reaches a free tier that may use it to improve products.

### Harness verification (MOCK, not provider evidence)

Run on 2026-10-30 in a scratch copy, with no real keys:

- `lint`, `typecheck`, `next build` pass; 16 unit tests pass (SSE parsing, header whitelist, retry and give-up logic, input validation, synthetic data).
- The CLI and the production route were driven against a fake Gemini/Groq server: model discovery, 768-dim probe, 429 then retry, 400 fallback when an API rejects `taskType`, give-up on a long `retry-after`, 100-chunk batching, SSE with CRLF, Groq reasoning deltas and `[DONE]`, and incremental delivery through `next start`.
- A scan found no key, token, `set-cookie`, or `?key=` URL in saved results or logs.

## 2. How to rerun (Windows, PowerShell, from the repo root)

Put `GEMINI_API_KEY`, `GROQ_API_KEY`, `SPIKE_TOKEN` (and optionally `SPIKE_BASE_URL`) in `.env.local`. Never paste them anywhere else.

```powershell
yarn install
yarn spike:provider --task=discover
yarn spike:provider --task=embed-probe --model=<embedding id from discover>
yarn spike:provider --task=embed-100 --model=<id> --batch=20
yarn spike:provider --task=stream --provider=gemini --model=<id> --prompt=short
yarn spike:provider --task=stream --provider=gemini --model=<id> --prompt=rag
yarn spike:provider --task=stream --provider=groq --model=openai/gpt-oss-120b --prompt=rag
```

Deployed (after pushing, with the three env vars set in Vercel): add `--target=deployed --base-url=https://groundwork-livid-iota.vercel.app` to the same commands (`discover` is local only).

**Wait at least 60 seconds between embedding runs.** One 100-chunk run is roughly 15-25K estimated tokens against a 30K tokens-per-minute cap, so back-to-back runs would produce a 429 caused by the test, not the provider. Results are saved under `spikes/provider/results/` (git-ignored).

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

Consequences to confirm (OPEN until tested):

- The Gemini Flash models at 20 RPD are too small for a public demo. Flash Lite (500 RPD) and Gemma 4 (14.4K RPD, 16K TPM) are the realistic Gemini LLM candidates.
- Embedding throughput is limited by 30K TPM, not by requests. A 30-page document may not ingest in under 60 s without pacing.
- Groq at 8K TPM allows only about two 3K-token RAG prompts per minute, and 200K TPD is about 60-70 such questions per day. Fallback only.
- It is unknown whether one `batchEmbedContents` call of N texts counts as 1 request or N requests against the 1K RPD. Measure by reading the console's peak usage before and after a run.
- The Gemini embedding console showed 1 request and 13 tokens, and Gemini 3.8 Flash showed 1 request, before this spike's tests (earlier manual use). Subtract this from any "before" reading.

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

Our adapter follows these rules by model id and falls back to raw text if an API answers 400. The console model names ("Gemini Embedding 2" / "Gemini Embedding 1") are assumed to map to these ids: **OPEN until `discover` confirms the exact ids available to your key.**

### Test log (all rows: not run yet)

| #   | Test                                                                                                                                  | Command                           | Result                           | Tag |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- | --- |
| 1   | Model discovery: exact ids visible to each key                                                                                        | `--task=discover`                 | ⬜ not run                       |     |
| 2   | 768 dimensions: native size, reduced size, vector norm (per candidate model)                                                          | `--task=embed-probe`              | ⬜ not run                       |     |
| 3   | 100 chunks in batches of 20, local: completion, retries, per-batch latency, dimension, retrieval 5/5                                  | `--task=embed-100`                | ⬜ not run                       |     |
| 4   | Same, through the deployed route                                                                                                      | `--target=deployed`               | ⬜ not run                       |     |
| 5   | Console RPD/TPM delta for one 100-chunk run (is a batch 1 request or N?)                                                              | read console before and after     | ⬜ not run                       |     |
| 6   | Gemini streamed answer (Flash Lite), short and RAG prompts, local                                                                     | `--task=stream --provider=gemini` | ⬜ not run                       |     |
| 7   | Gemini streamed answer, deployed: incremental arrival                                                                                 | `--target=deployed`               | ⬜ not run                       |     |
| 8   | Gemma 4 one streamed RAG answer                                                                                                       | `--task=stream`                   | ⬜ not run                       |     |
| 9   | Groq streamed answer (gpt-oss-120b), short and RAG, local                                                                             | `--provider=groq`                 | ⬜ not run                       |     |
| 10  | Groq deployed                                                                                                                         | `--target=deployed`               | ⬜ not run                       |     |
| 11  | Groq qwen3.8-27b one RAG answer                                                                                                       | `--provider=groq`                 | ⬜ not run                       |     |
| 12  | Provider switch: same prompt, both adapters unchanged behind `LlmProvider`; note reasoning-field handling, token limits, error shapes | compare 6 and 9                   | ⬜ not run                       |     |
| 13  | HTTP 429 behaviour (passive only; no deliberate probe)                                                                                | observed during 3-11              | ⬜ not run / may stay unobserved |     |

### Measurements to record per test

Model id; date; HTTP statuses; per-batch and total latency; time to first token; total stream time; whether text arrived incrementally; vector length and norm; finish reason; reported token usage; any `retry-after` and `x-ratelimit-*` values; the console's before/after usage.

## 6. Decision rules (applied only once section 5 has real data)

1. The embedding model must return 768-length, finite vectors in all three real runs (probe, local batch, deployed batch).
2. Retrieval check must rank the right chunk first for all 5 answerable questions; record the top-1 similarity of the unanswerable question to inform the Slice 2 refusal threshold.
3. Prefer a model documented as stable over a preview model. If both qualify, prefer the one with fewer manual steps (auto-normalized, larger input limit).
4. If the vectors are not unit length, the adapter must L2-normalize before storing (record this in the decision).
5. If no Gemini embedding model can produce 768 dimensions, or a 30-page ingest is impractical at the measured TPM, recommend the Cloudflare Workers AI or Jina alternative **before** migration 0004 is written.
6. `vector(768)` in DATA_MODEL stays as is unless rule 5 triggers.

## 7. Unresolved questions

- Exact embedding and LLM model ids available to your keys (test 1).
- Whether a batch counts as 1 or N requests toward RPD (test 5).
- Real 429 behaviour on both providers (test 13). It stays unobserved unless a run happens to hit a limit. If it does not, a small deliberate probe is needed to meet the 0.5 criterion "behavior on HTTP 429", and that needs Joshua's explicit approval.
- Whether either provider needs a card for ongoing use.
- Whether Groq uses free-tier inputs for training (the retention page is silent).
- Latency from Vercel's function region to each provider (record `x-vercel-id` from deployed runs).

## 8. Cleanup when the spike is finished

- Delete `app/api/spike/route.ts`; keep `spikes/provider/` until task 10.x ("Move or delete /spikes").
- Rotate or delete `SPIKE_TOKEN` in Vercel and remove `GEMINI_API_KEY`/`GROQ_API_KEY` from the Vercel project only if they are no longer needed (they will be needed from Slice 1).
- Do not commit `spikes/provider/results/`.

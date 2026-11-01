# Spike 0.8: streaming through Vercel

**Status (2026-11-01): the Task 0.8 acceptance criteria are met for the tested environments.** A temporary route sent 16 events 300 ms apart, and a client page rendered them progressively in local development, in a local production build, and on a **Vercel preview deployment**, with no buffering observed. `maxDuration = 10` is set explicitly in the route, after checking Vercel's current documentation (Hobby: 300 s default and maximum with Fluid compute). **This was a feasibility spike, not the production streaming implementation:** the stream event contract and parser belong to Task 1.8, and `/api/ask` belongs to Task 1.9. Each environment was run once, and the browser numbers are as reported by the project owner (section 2). The production domain, other browsers, POST requests and real LLM streams were not tested (section 5).

## Acceptance criteria (Task 0.8)

| Criterion                                                                                  | Status                       | Where / caveat                                                                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| On the **deployed** URL, events appear incrementally rather than all at once at the end    | Met, on a Vercel preview URL | Section 2.2. One run, reported by the project owner. The production domain was not tested.               |
| Function max duration confirmed from Vercel's current docs and set explicitly in the route | Met                          | Section 3. `maxDuration = 10`. Docs read 2026-11-01. That Vercel enforces the 10 s limit was not tested. |

## How to read this document

| Tag        | Meaning                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NODE**   | Claude called the route handler directly in Node (no Next.js, no browser, no network). Shows the server emits incrementally. It says nothing about whether any platform delivers it that way.                                                  |
| **LOCAL**  | The browser page against a Next.js server on the project owner's machine (`yarn dev`, or `yarn build && yarn start`). Numbers reported by the project owner from the page's readout; Claude did not see the page. Proves nothing about Vercel. |
| **VERCEL** | The same page and route on a deployed Vercel preview. Reported by the project owner in the same way. This is the only deployed evidence.                                                                                                       |
| **DOC**    | Read from Vercel's documentation. Not confirmed by a request.                                                                                                                                                                                  |
| **INFER**  | Inference from the numbers. Consistent with the evidence, not proven.                                                                                                                                                                          |
| **OPEN**   | Unknown.                                                                                                                                                                                                                                       |

## 1. What was built

All temporary.

- `app/api/spike-stream/route.ts`: a `GET` handler returning `text/event-stream; charset=utf-8` with `Cache-Control: no-cache, no-transform`. It sends one comment frame at once (so headers and the first bytes leave immediately), then 16 `tick` events 300 ms apart as `data: <json>` frames, then a `done` event at about 5 s. The `Response` is returned before any timed work starts, and timers are cleared on cancel or client abort. It sets `export const maxDuration = 10`. It has no `SPIKE_TOKEN` gate: it takes no input, returns nothing sensitive, and the browser page cannot hold a secret.
- `app/spike/stream/page.tsx`: a client page with a Start button. It reads the stream with `fetch` and a stream reader (not `EventSource`, because Task 1.9 is planned to use POST) and shows when each chunk arrived, in milliseconds after the click. It has idle, streaming, done and error states; errors cover a failed fetch, a non-200 response, and a stream that ends without `done`. It labels a run "Incremental" when the first tick arrives under 1,500 ms and the first-to-last-tick spread is over 3,000 ms. Those thresholds were chosen for this spike, not taken from a standard.
- No configuration changed and there is no `vercel.json`.

The event shape (`tick`, `done`, a sequence number and a server time) is throwaway. The production event contract (`sources`, `token`, `done`, `not_found`, `limit`, `error`) and its parser are Task 1.8, and the production route is Task 1.9.

## 2. Results

With real streaming, the first tick is expected near 300 ms and the last near 4,800 ms, so a spread near **4,500 ms**. If the platform buffered the response, the first tick would arrive near 5 s and the spread would be close to zero.

### 2.1 Local evidence (NODE and LOCAL)

| Environment                                   | Tag   | First tick   | Spread       | Result                                                                                                                                                               |
| --------------------------------------------- | ----- | ------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route handler called directly in Node         | NODE  | about 346 ms | not recorded | Incremental. 18 separate reads over about 5.05 s: 1 comment frame, 16 ticks, 1 `done`. Only the first two ticks (346 ms, 646 ms) and `done` (5,054 ms) were printed. |
| Local development (`yarn dev`)                | LOCAL | 931 ms       | 4,678 ms     | 16 ticks delivered progressively at approximately 300 ms intervals. No buffering observed.                                                                           |
| Local production (`yarn build && yarn start`) | LOCAL | 333 ms       | 4,682 ms     | 16 ticks delivered progressively at approximately 300 ms intervals. No buffering observed.                                                                           |

The development first tick is slower than the production one. Likely cause (INFER, not checked): first-request compilation in `next dev`. The spreads match.

### 2.2 Deployed evidence (VERCEL)

| Environment    | Tag    | First tick | Spread   | Result                                                                                     |
| -------------- | ------ | ---------- | -------- | ------------------------------------------------------------------------------------------ |
| Vercel preview | VERCEL | 735 ms     | 4,491 ms | 16 ticks delivered progressively at approximately 300 ms intervals. No buffering observed. |

Not recorded for this run: the preview URL, function region, runtime version, browser, and whether Deployment Protection was on.

### 2.3 What the results show

- By the page's own thresholds (first tick under 1,500 ms, spread over 3,000 ms), all three browser runs count as incremental. All three spreads are within 200 ms of the ideal 4,500 ms.
- **No buffering was observed in the tested environments.** That means one run each: the local dev server, the local production server, and one Vercel preview deployment. It does not show the same on the production domain, in other regions or browsers, or behind other networks.
- The tested route included `Cache-Control: no-transform` and the early comment frame. Whether either is needed was not tested (OPEN).

## 3. Function duration (DOC)

| Item          | Finding                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources       | https://vercel.com/docs/functions/limitations and https://vercel.com/docs/functions/configuring-functions/duration. Both pages showed "last updated 2026-08-24" when read on 2026-11-01.          |
| Hobby limit   | 300 s default and 300 s maximum, with Fluid compute. Streamed response time counts towards the duration.                                                                                          |
| Older figures | Older material (10 to 60 s) conflicts with this. The two pages above are the basis used here.                                                                                                     |
| Fluid compute | The duration page says it is enabled by default. This report did not inspect the project's own setting (Settings, Functions).                                                                     |
| Setting used  | `export const maxDuration = 10;` in the route (the named export the duration page documents for the Next.js App Router). The stream needs about 5 s, so 10 s leaves headroom far below the limit. |
| Plan          | Hobby, per the project's own documents. Not re-checked here.                                                                                                                                      |
| Not tested    | That Vercel applies and enforces the 10 s value. No request was made to exceed it, and function configuration and runtime logs were not reviewed.                                                 |

For Task 1.9: choose `maxDuration` for that route deliberately. The limit includes time spent streaming.

## 4. Decision

1. A Next.js Route Handler streaming events progressively works on a Vercel preview deployment for this pattern, so the results give no reason to change the approach in `ARCHITECTURE.md` (hand-rolled SSE-style stream from a route handler).
2. Set `maxDuration` explicitly on each long-running route, with a value chosen per route.
3. **The production streaming architecture is not decided here.** The event contract and client parser are Task 1.8, and `/api/ask` is Task 1.9.

## 5. Limitations and open items

- **One run per environment.** The browser numbers are as reported by the project owner. Claude did not see the page, and the page has no export, so no result files exist to review.
- **Preview deployment only.** The production domain was not tested. Preview URL, region, runtime, browser and Deployment Protection state were not recorded.
- **Browser and network.** The browser is not identified. Other browsers, mobile, and networks with proxies or VPNs were not tested; an intermediary can buffer a stream even when the platform does not.
- **Synthetic stream.** A GET with no input, no session, and 16 small events over 5 s. Not tested: POST with a JSON body, authentication, real LLM tokens, longer streams, bursts, a mid-stream failure, or a client disconnect on Vercel.
- **No raw `curl -N` result** was reported for local or deployed runs.
- **Duration limit.** The 10 s value was set but its enforcement was not tested. Vercel runtime logs were not reviewed. The project's Fluid compute setting was not inspected.
- **`no-transform` and the comment frame.** Both were in the tested route. Whether either is required is OPEN.
- **Related documents not changed by this report.** `docs/spikes/pdf.md` still lists `maxDuration` as applied by Vercel among the untested items, the Task 0.6 routes still set 60, and ARCHITECTURE and BUILD_PLAN still carry their "verify" notes about the Hobby limit.

## 6. Run it yourself

```bash
yarn dev                          # open /spike/stream, press Start
yarn build && yarn start          # repeat on the production build
curl -N http://localhost:3000/api/spike-stream   # lines should print one at a time
```

On Vercel, push a branch, open `/spike/stream` on the preview URL and press Start. A pass is a first tick under 1,500 ms and a spread over 3,000 ms (about 300 ms and 4,500 ms is typical). If every row appears together at about 5 s, the response was buffered.

## 7. Cleanup when the spike is finished

Delete `app/api/spike-stream/` and `app/spike/stream/`. There are no environment variables or secrets to rotate.

// Node preload for the abuse load test (Task 5.7). Wraps `fetch` in the Next
// server and appends one JSON line per call it cares about to the file named
// by LOAD_TEST_CALL_LOG. It passes every request through unchanged and records
// only a kind, never a URL, header or body, so no key can reach the log.
//
//   LOAD_TEST_CALL_LOG=/tmp/calls.log \
//   NODE_OPTIONS="--import ./scripts/load-test/count-provider-fetch.mjs" \
//   yarn start
import { appendFileSync } from "node:fs";

const logPath = process.env.LOAD_TEST_CALL_LOG;
const originalFetch = globalThis.fetch;

function kindOf(input) {
  let url;
  try {
    const raw =
      typeof input === "string" || input instanceof URL ? input : input.url;
    url = new URL(raw);
  } catch {
    return null;
  }
  const { hostname, pathname } = url;
  if (hostname === "generativelanguage.googleapis.com") {
    return /embed/i.test(pathname) ? "embed" : "llm";
  }
  if (hostname === "api.groq.com") return "groq";
  if (pathname.endsWith("/rest/v1/rpc/consume_usage")) return "consume";
  if (pathname.endsWith("/rest/v1/rpc/refund_usage")) return "refund";
  return null;
}

if (logPath && typeof originalFetch === "function") {
  globalThis.fetch = function countedFetch(input, init) {
    const kind = kindOf(input);
    if (kind !== null) {
      try {
        appendFileSync(logPath, `${JSON.stringify({ k: kind })}\n`);
      } catch {
        // Counting must never break a request.
      }
    }
    return originalFetch.call(globalThis, input, init);
  };
}

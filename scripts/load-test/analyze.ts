/**
 * Pure analysis for the abuse load test (Task 5.7). No I/O, no `server-only`:
 * `scripts/abuse-load-test.ts` collects the numbers, this file judges them, and
 * `tests/unit/abuse-load-test.test.ts` covers it.
 */

/** What one `/api/ask` request turned into, as the client sees it. */
export type Outcome =
  | { kind: "answered" }
  | { kind: "not_found" }
  | { kind: "limit"; reason: string }
  | { kind: "stream_error"; code: string }
  | { kind: "http_error"; status: number }
  | { kind: "network_error" };

/** `cooldown`: one user, parallel requests. `burst`: many users at once. */
export type Phase = "cooldown" | "burst";

export interface RequestResult {
  phase: Phase;
  outcome: Outcome;
  /** Milliseconds until the whole response body was read. */
  ms: number;
}

/**
 * Calls seen by the Next server (`count-provider-fetch.mjs`), by kind. `llm`
 * counts Gemini generation calls and `groq` Groq calls, so a failover shows.
 */
export interface CallCounts {
  consume: number;
  refund: number;
  embed: number;
  llm: number;
  groq: number;
}

export interface Check {
  name: string;
  pass: boolean;
  /** A failed warning is reported but does not fail the run. */
  level: "fail" | "warn";
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads the terminal event of an SSE body, or null when there is none. */
function terminalEvent(body: string): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  for (const frame of body.split("\n\n")) {
    const line = frame.trim();
    if (!line.startsWith("data:")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice("data:".length).trim());
    } catch {
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") continue;
    if (["done", "not_found", "limit", "error"].includes(parsed.type)) {
      last = parsed;
    }
  }
  return last;
}

/** Turns an HTTP status and body into an outcome. Never throws. */
export function classifyResponse(status: number, body: string): Outcome {
  if (status !== 200) return { kind: "http_error", status };
  const event = terminalEvent(body);
  if (event === null) return { kind: "stream_error", code: "no_terminal" };
  switch (event.type) {
    case "done":
      return { kind: "answered" };
    case "not_found":
      return { kind: "not_found" };
    case "limit":
      return {
        kind: "limit",
        reason: typeof event.reason === "string" ? event.reason : "unknown",
      };
    default:
      return {
        kind: "stream_error",
        code: typeof event.code === "string" ? event.code : "unknown",
      };
  }
}

/** Nearest-rank percentile of a list of numbers; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface Summary {
  total: number;
  answered: number;
  notFound: number;
  limited: Record<string, number>;
  streamErrors: number;
  http5xx: number;
  otherHttpErrors: number;
  networkErrors: number;
  /** Units spent by the limiter: requests that got past `consume_usage`. */
  spent: number;
  limitLatency: { p50: number; p95: number; max: number };
  allowedLatency: { p50: number; p95: number; max: number };
}

function latency(values: number[]): { p50: number; p95: number; max: number } {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

export function summarize(results: readonly RequestResult[]): Summary {
  const limited: Record<string, number> = {};
  const limitMs: number[] = [];
  const allowedMs: number[] = [];
  let answered = 0;
  let notFound = 0;
  let streamErrors = 0;
  let http5xx = 0;
  let otherHttpErrors = 0;
  let networkErrors = 0;

  for (const { outcome, ms } of results) {
    switch (outcome.kind) {
      case "answered":
        answered += 1;
        allowedMs.push(ms);
        break;
      case "not_found":
        notFound += 1;
        allowedMs.push(ms);
        break;
      case "limit":
        limited[outcome.reason] = (limited[outcome.reason] ?? 0) + 1;
        limitMs.push(ms);
        break;
      case "stream_error":
        streamErrors += 1;
        allowedMs.push(ms);
        break;
      case "http_error":
        if (outcome.status >= 500) http5xx += 1;
        else otherHttpErrors += 1;
        break;
      case "network_error":
        networkErrors += 1;
        break;
    }
  }

  return {
    total: results.length,
    answered,
    notFound,
    limited,
    streamErrors,
    http5xx,
    otherHttpErrors,
    networkErrors,
    // A stream error only happens after the unit was spent.
    spent: answered + notFound + streamErrors,
    limitLatency: latency(limitMs),
    allowedLatency: latency(allowedMs),
  };
}

export interface AnalyzeInput {
  results: readonly RequestResult[];
  calls: CallCounts;
  /** `usage_global_daily.used` for questions, before and after the run. */
  globalBefore: number;
  globalAfter: number;
  /** How many questions the global cap lets through in this run. */
  cap: number;
  /** Slowest acceptable `limit` response (p95), in milliseconds. */
  maxLimitMs: number;
}

export interface Analysis {
  summary: Summary;
  checks: Check[];
}

function count(summary: Summary, reason: string): number {
  return summary.limited[reason] ?? 0;
}

/** Judges one run against the Task 5.7 criteria. */
export function analyzeRun(input: AnalyzeInput): Analysis {
  const { results, calls, cap, maxLimitMs } = input;
  const summary = summarize(results);
  const checks: Check[] = [];
  const add = (
    name: string,
    pass: boolean,
    detail: string,
    level: Check["level"] = "fail",
  ) => checks.push({ name, pass, level, detail });

  const unexpected =
    summary.streamErrors +
    summary.otherHttpErrors +
    summary.networkErrors +
    summary.http5xx;

  add(
    "No 5xx and no failed streams",
    unexpected === 0,
    `5xx ${summary.http5xx}, other HTTP errors ${summary.otherHttpErrors}, stream errors ${summary.streamErrors}, network errors ${summary.networkErrors}`,
  );

  // The limiter is reached by every well-formed, signed-in request.
  add(
    "Every request reached the limiter",
    calls.consume === summary.total,
    `${summary.total} requests, ${calls.consume} consume_usage calls`,
  );

  const burstTotal = results.filter((r) => r.phase === "burst").length;
  const delta = input.globalAfter - input.globalBefore;
  if (unexpected === 0) {
    add(
      "Global counter matches spent units",
      delta === summary.spent - calls.refund,
      `counter moved by ${delta}; ${summary.spent} spent, ${calls.refund} refunds`,
    );
    add(
      "Global cap tripped at the configured number",
      delta === cap && count(summary, "global_limit") > 0,
      `cap ${cap}, counter moved by ${delta}, ${count(summary, "global_limit")} global_limit responses out of ${burstTotal} burst requests`,
    );
  } else {
    add(
      "Global counter matches spent units",
      false,
      "skipped: unexpected outcomes make the spent count ambiguous",
    );
  }

  // Provider calls. A spent unit makes exactly one embedding call and an
  // answer exactly one LLM call. Extra calls mean either retries after a 429
  // (check the app's log) or a blocked request that reached a provider, and
  // the counts alone cannot tell the two apart, so both fail the run.
  add(
    "Embedding calls equal spent units",
    calls.embed === summary.spent,
    `${calls.embed} embedding calls, ${summary.spent} spent units, ${summary.total - summary.spent} blocked; extra calls mean retries or a blocked request that reached the provider`,
  );
  const llmCalls = calls.llm + calls.groq;
  add(
    "LLM calls equal answered questions",
    llmCalls === summary.answered,
    `${llmCalls} LLM calls (Gemini ${calls.llm}, Groq ${calls.groq}), ${summary.answered} answers; refusals and blocked requests must make none`,
  );

  add(
    "Blocked requests answer fast",
    summary.limitLatency.p95 <= maxLimitMs,
    `limit responses p50 ${summary.limitLatency.p50} ms, p95 ${summary.limitLatency.p95} ms, max ${summary.limitLatency.max} ms (budget p95 ${maxLimitMs} ms)`,
  );

  const cooldown = results.filter((r) => r.phase === "cooldown");
  if (cooldown.length > 0) {
    const spent = cooldown.filter(
      (r) => r.outcome.kind === "answered" || r.outcome.kind === "not_found",
    ).length;
    const blocked = cooldown.filter(
      (r) => r.outcome.kind === "limit" && r.outcome.reason === "cooldown",
    ).length;
    add(
      "Cooldown lets one of parallel requests through",
      spent === 1 && blocked === cooldown.length - 1,
      `${cooldown.length} parallel requests from one user: ${spent} allowed, ${blocked} cooldown`,
    );
  }

  return { summary, checks };
}

/**
 * The safe global question cap: the provider's daily request limit for the
 * binding model, times the fraction left for retries, dev and eval runs that
 * share the key. Rounded down.
 */
export function suggestGlobalCap(
  dailyRequestLimit: number,
  fraction: number,
): number {
  if (!Number.isFinite(dailyRequestLimit) || dailyRequestLimit <= 0) return 0;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) return 0;
  return Math.floor(dailyRequestLimit * fraction);
}

/** Renders the run as Markdown for `docs/decisions.md`. */
export function renderReport(
  analysis: Analysis,
  meta: { cap: number; sessions: number; suggestedCap: number },
): string {
  const { summary, checks } = analysis;
  const lines = [
    "# Abuse load test",
    "",
    `Sessions: ${meta.sessions}. Cap under test: ${meta.cap}.`,
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...checks.map(
      (c) =>
        `| ${c.name} | ${c.pass ? "pass" : c.level === "warn" ? "warn" : "FAIL"} | ${c.detail} |`,
    ),
    "",
    `Outcomes: ${summary.answered} answered, ${summary.notFound} not found, ` +
      `${
        Object.entries(summary.limited)
          .map(([reason, n]) => `${n} ${reason}`)
          .join(", ") || "0 limited"
      }.`,
    `Answered and refused requests: p50 ${summary.allowedLatency.p50} ms, p95 ${summary.allowedLatency.p95} ms, max ${summary.allowedLatency.max} ms.`,
    "",
    `Suggested limit_global_question: ${meta.suggestedCap}.`,
  ];
  return lines.join("\n");
}

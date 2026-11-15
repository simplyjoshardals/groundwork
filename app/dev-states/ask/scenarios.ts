import { AskHttpError, AskNetworkError } from "@/lib/ask-client";
import type { AskStream } from "@/components/ask-panel";
import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";

/**
 * Scripted answers for the dev drill (`/dev-states/ask/<scenario>`), so every
 * state of the ask experience can be reached without a backend, a provider
 * failure or a spent budget. Dev only: the route is a 404 outside `next dev`.
 */

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

const SOURCES: StreamSource[] = [
  {
    marker: 1,
    documentId: ids[0],
    chunkId: 101,
    documentTitle: "Employee handbook",
    page: 3,
    snippet:
      "Full-time employees receive 26 days of paid annual leave in each leave year, in addition to public holidays. Leave accrues monthly from the start date.",
  },
  {
    marker: 2,
    documentId: ids[0],
    chunkId: 102,
    documentTitle: "Employee handbook",
    page: 4,
    snippet:
      "Up to five days of unused annual leave may be carried into the next leave year and must be used by 31 March.",
  },
  {
    marker: 3,
    documentId: ids[1],
    chunkId: 201,
    documentTitle: "Expenses policy",
    page: 2,
    snippet:
      "Claims must be submitted within 30 days of the expense, with a receipt for anything over ten dollars.",
  },
];

const ANSWER = [
  "A full-time employee gets 26 days of paid annual leave each leave year [1].",
  "Up to five unused days can be carried over, and they must be taken by 31 March [2].",
  "Separately, expense claims have their own 30-day deadline [3].",
];

const RESET = new Date(Date.now() + 6 * 3600_000).toISOString();
const USAGE = { remaining: 17, dailyLimit: 20, resetsAt: RESET };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Tokens of `text`, a few words at a time, `gap` ms apart. */
async function* tokens(
  text: string,
  gap: number,
  signal: AbortSignal,
): AsyncGenerator<AskStreamEvent> {
  for (const piece of text.match(/\S+\s*|\n+/g) ?? []) {
    if (signal.aborted) return;
    yield { type: "token", text: piece };
    await sleep(gap, signal);
  }
}

const done: AskStreamEvent = {
  type: "done",
  citations: [1, 2, 3],
  invalidCitations: [],
  usage: USAGE,
};

export const SCENARIOS = {
  answer: {
    title: "Cited answer (fast)",
    stream: async function* (_q, { signal }) {
      await sleep(400, signal);
      yield { type: "sources", sources: SOURCES };
      yield* tokens(ANSWER.join("\n\n"), 25, signal);
      yield done;
    },
  },
  slow: {
    title: "Slow: 3 s to sources, 120 ms per word",
    stream: async function* (_q, { signal }) {
      await sleep(3000, signal);
      yield { type: "sources", sources: SOURCES };
      await sleep(1500, signal);
      yield* tokens(ANSWER.join("\n\n"), 120, signal);
      yield done;
    },
  },
  refusal: {
    title: "Refusal with closest passages",
    stream: async function* (_q, { signal }) {
      await sleep(600, signal);
      yield { type: "not_found", closest: SOURCES.slice(0, 2), usage: USAGE };
    },
  },
  "refusal-bare": {
    title: "Refusal, nothing close",
    stream: async function* (_q, { signal }) {
      await sleep(600, signal);
      yield { type: "not_found", closest: [], usage: USAGE };
    },
  },
  empty: {
    title: "Done with no text",
    stream: async function* (_q, { signal }) {
      await sleep(400, signal);
      yield { type: "sources", sources: SOURCES };
      yield done;
    },
  },
  "error-early": {
    title: "Error before any text",
    stream: async function* (_q, { signal }) {
      await sleep(600, signal);
      yield { type: "error", code: "search_unavailable", message: "x" };
    },
  },
  "error-mid": {
    title: "Error mid-stream (partial answer stays)",
    stream: async function* (_q, { signal }) {
      await sleep(400, signal);
      yield { type: "sources", sources: SOURCES };
      yield* tokens(ANSWER[0], 40, signal);
      yield { type: "error", code: "interrupted", message: "x" };
    },
  },
  fallback: {
    title: "Provider fallback (closest passages)",
    stream: async function* (_q, { signal }) {
      await sleep(500, signal);
      yield { type: "sources", sources: SOURCES };
      yield { type: "error", code: "llm_unavailable", message: "x" };
    },
  },
  "limit-daily": {
    title: "Daily limit",
    stream: async function* () {
      yield {
        type: "limit",
        scope: "user",
        reason: "user_limit",
        resetsAt: RESET,
      };
    },
  },
  "limit-cooldown": {
    title: "Too fast (cooldown)",
    stream: async function* () {
      yield {
        type: "limit",
        scope: "user",
        reason: "cooldown",
        resetsAt: RESET,
      };
    },
  },
  "limit-global": {
    title: "Demo resting (kill switch)",
    stream: async function* () {
      yield {
        type: "limit",
        scope: "global",
        reason: "global_limit",
        resetsAt: RESET,
      };
    },
  },
  network: {
    title: "Connection lost",
    stream: async function* (_q, { signal }) {
      await sleep(500, signal);
      throw new AskNetworkError();
    },
  },
  expired: {
    title: "Expired demo session (401)",
    stream: async function* (_q, { signal }) {
      await sleep(300, signal);
      throw new AskHttpError(401);
    },
  },
} satisfies Record<string, { title: string; stream: AskStream }>;

export type ScenarioName = keyof typeof SCENARIOS;

export function isScenario(value: string): value is ScenarioName {
  return Object.hasOwn(SCENARIOS, value);
}

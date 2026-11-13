/**
 * Abuse load test (Task 5.7): many anonymous sessions ask questions at once
 * while the global question cap is set low, to prove the cap trips at the
 * configured number, that provider calls match the counters, that nothing
 * answers 5xx, and that blocked requests are fast.
 *
 *   yarn load:abuse --call-log <file> [--sessions 50] [--cap 10]
 *     [--base-url http://localhost:3000] [--max-limit-ms 2000]
 *     [--llm-rpd 500] [--fraction 0.5]
 *
 * Start the app first, from a production build, with the counting preload:
 *
 *   yarn build
 *   LOAD_TEST_CALL_LOG=<file> NODE_OPTIONS="--import ./scripts/load-test/count-provider-fetch.mjs" yarn start
 *
 * It spends REAL Gemini quota, at most `--cap` questions' worth (a blocked
 * request makes no provider call). It only runs against the local Supabase
 * stack and a local app: there is no override, because the hosted project has
 * a real CAPTCHA and shares the real quota. The global cap is set to
 * "used so far today + cap" for the run and restored afterwards, also on Ctrl+C.
 */
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import {
  analyzeRun,
  classifyResponse,
  renderReport,
  suggestGlobalCap,
  type CallCounts,
  type RequestResult,
} from "./load-test/analyze";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { TURNSTILE_DUMMY_TOKEN } from "@/lib/turnstile/test-keys";
import type { Database } from "@/types/database";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const CAP_KEY = "limit_global_question";
const REQUEST_TIMEOUT_MS = 90_000;
// `refund_usage` is fire-and-forget in the route; give it time to land.
const SETTLE_MS = 1500;

// Questions the sample FAQ answers, and some it cannot (refused by gate #1,
// which must make no LLM call).
const ANSWERABLE = [
  "How many days of annual leave do I get?",
  "Can I carry over unused leave?",
  "How do I request leave?",
  "What should I do if I am too ill to work?",
  "How many days a week do I have to be in the office?",
  "Can I work from another country?",
  "When do I get the home-office stipend?",
];
const UNRELATED = [
  "What is the capital of Australia?",
  "How do I bake sourdough bread?",
];

interface Options {
  sessions: number;
  cap: number;
  baseUrl: string;
  callLog: string;
  maxLimitMs: number;
  llmRpd: number;
  fraction: number;
}

function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** Reads `--name value` pairs. Returns an error message for bad input. */
function parseOptions(args: string[]): Options | string {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (!name?.startsWith("--") || value === undefined) {
      return `Bad arguments near "${(name ?? "").slice(0, 30)}". Use --name value pairs.`;
    }
    values.set(name, value);
  }
  const known = [
    "--sessions",
    "--cap",
    "--base-url",
    "--call-log",
    "--max-limit-ms",
    "--llm-rpd",
    "--fraction",
  ];
  for (const name of values.keys()) {
    if (!known.includes(name)) return `Unknown option ${name.slice(0, 30)}.`;
  }

  const number = (name: string, fallback: number): number =>
    Number(values.get(name) ?? fallback);
  const options: Options = {
    sessions: number("--sessions", 50),
    cap: number("--cap", 10),
    baseUrl: values.get("--base-url") ?? "http://localhost:3000",
    callLog: values.get("--call-log") ?? "",
    maxLimitMs: number("--max-limit-ms", 2000),
    llmRpd: number("--llm-rpd", 500),
    fraction: number("--fraction", 0.5),
  };
  if (options.callLog === "") {
    return "Missing --call-log <file>: the file the app's preload writes to (LOAD_TEST_CALL_LOG).";
  }
  if (!Number.isInteger(options.sessions) || options.sessions < 2) {
    return "--sessions must be an integer of at least 2.";
  }
  if (!Number.isInteger(options.cap) || options.cap < 2) {
    return "--cap must be an integer of at least 2 (one unit goes to the cooldown phase).";
  }
  if (options.cap >= options.sessions) {
    return "--cap must be lower than --sessions, or the cap cannot trip.";
  }
  return options;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Session {
  cookie: string;
}

/** Signs in one anonymous user and returns the cookies the app expects. */
async function createSession(): Promise<Session> {
  const jar = new Map<string, string>();
  const supabase = createServerClient<Database>(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll(cookies) {
          for (const { name, value } of cookies) {
            if (value === "") jar.delete(name);
            else jar.set(name, value);
          }
        },
      },
    },
  );
  const { error } = await supabase.auth.signInAnonymously({
    options: { captchaToken: TURNSTILE_DUMMY_TOKEN },
  });
  if (error) {
    throw new Error(
      `Anonymous sign-in failed (status ${error.status ?? "unknown"}). If it is 429, raise [auth.rate_limit] anonymous_users in supabase/config.toml and restart the local stack.`,
    );
  }
  // Cookies are written on the sign-in event; make sure they have landed.
  if (jar.size === 0) await supabase.auth.getSession();
  if (jar.size === 0) throw new Error("Sign-in produced no session cookies.");
  return {
    cookie: [...jar]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; "),
  };
}

async function ask(
  baseUrl: string,
  session: Session,
  question: string,
  phase: RequestResult["phase"],
): Promise<RequestResult> {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.cookie },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    return {
      phase,
      outcome: classifyResponse(response.status, body),
      ms: Math.round(performance.now() - started),
    };
  } catch {
    return {
      phase,
      outcome: { kind: "network_error" },
      ms: Math.round(performance.now() - started),
    };
  }
}

/** Counts the call-log lines written after `skip` lines. */
function readCalls(path: string, skip: number): CallCounts {
  const counts: CallCounts = {
    consume: 0,
    refund: 0,
    embed: 0,
    llm: 0,
    groq: 0,
  };
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return counts;
  }
  for (const line of text.split("\n").slice(skip)) {
    if (line === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const kind =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { k?: unknown }).k
          : undefined;
      if (typeof kind === "string" && kind in counts) {
        counts[kind as keyof CallCounts] += 1;
      }
    } catch {
      // A half-written line at the end of the file is ignored.
    }
  }
  return counts;
}

function lineCount(path: string): number {
  try {
    return readFileSync(path, "utf8").split("\n").length - 1;
  } catch {
    return 0;
  }
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "string") {
    console.error(options);
    return 1;
  }
  if (!isLocalUrl(supabaseUrl()) || !isLocalUrl(options.baseUrl)) {
    console.error(
      "Refusing to run: both NEXT_PUBLIC_SUPABASE_URL and --base-url must be local addresses. This test is never run against the hosted project.",
    );
    return 1;
  }

  const admin = createAdminSupabase();
  const day = utcDay();

  const { data: config, error: configError } = await admin
    .from("app_config")
    .select("value")
    .eq("key", CAP_KEY)
    .single();
  if (configError) {
    console.error(`Could not read ${CAP_KEY} (${configError.code}).`);
    return 1;
  }
  const originalCap = config.value;

  const { count: sampleDocs, error: docsError } = await admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("is_public", true)
    .eq("status", "ready");
  if (docsError || !sampleDocs) {
    console.error(
      "No ready public sample document found. Run `yarn seed:samples` first.",
    );
    return 1;
  }

  const readGlobalUsed = async (): Promise<number> => {
    const { data, error } = await admin
      .from("usage_global_daily")
      .select("used")
      .eq("day", day)
      .eq("kind", "question")
      .maybeSingle();
    if (error)
      throw new Error(`Reading usage_global_daily failed (${error.code}).`);
    return data?.used ?? 0;
  };

  let restored = false;
  const restoreCap = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    const { error } = await admin
      .from("app_config")
      .update({ value: originalCap })
      .eq("key", CAP_KEY);
    if (error) {
      console.error(
        `COULD NOT RESTORE ${CAP_KEY}. Set it back to ${originalCap} by hand: update app_config set value = ${originalCap} where key = '${CAP_KEY}';`,
      );
    }
  };
  process.once("SIGINT", () => {
    void restoreCap().finally(() => process.exit(130));
  });

  try {
    console.info(
      `Signing in ${options.sessions + 1} anonymous sessions (${options.sessions} burst + 1 cooldown)...`,
    );
    const sessions: Session[] = [];
    for (let i = 0; i < options.sessions + 1; i += 10) {
      const batch = Math.min(10, options.sessions + 1 - i);
      sessions.push(
        ...(await Promise.all(Array.from({ length: batch }, createSession))),
      );
    }
    const [cooldownUser, ...burstUsers] = sessions;

    const globalBefore = await readGlobalUsed();
    const logOffset = lineCount(options.callLog);
    const { error: setError } = await admin
      .from("app_config")
      .update({ value: globalBefore + options.cap })
      .eq("key", CAP_KEY);
    if (setError)
      throw new Error(`Setting ${CAP_KEY} failed (${setError.code}).`);
    console.info(
      `${CAP_KEY} set to ${globalBefore + options.cap} (used so far today ${globalBefore} + cap ${options.cap}); original ${originalCap} is restored afterwards.`,
    );

    const results: RequestResult[] = [];

    // Phase 1: one user, three parallel requests: one allowed, two cooldown.
    console.info("Phase 1: cooldown (1 user, 3 parallel requests)...");
    results.push(
      ...(await Promise.all(
        [0, 1, 2].map(() =>
          ask(options.baseUrl, cooldownUser, ANSWERABLE[0], "cooldown"),
        ),
      )),
    );

    // Phase 2: every session at once. Every fourth question is off-topic.
    console.info(`Phase 2: burst (${burstUsers.length} sessions at once)...`);
    results.push(
      ...(await Promise.all(
        burstUsers.map((session, i) =>
          ask(
            options.baseUrl,
            session,
            i % 4 === 3
              ? UNRELATED[i % UNRELATED.length]
              : ANSWERABLE[i % ANSWERABLE.length],
            "burst",
          ),
        ),
      )),
    );

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    if (utcDay() !== day) {
      console.error("The UTC day changed during the run; run it again.");
      return 1;
    }
    const globalAfter = await readGlobalUsed();
    const calls = readCalls(options.callLog, logOffset);
    if (calls.consume === 0) {
      console.error(
        "The call log recorded nothing. Is the app running with the counting preload and the same --call-log file?",
      );
      return 1;
    }

    const analysis = analyzeRun({
      results,
      calls,
      globalBefore,
      globalAfter,
      cap: options.cap,
      maxLimitMs: options.maxLimitMs,
    });
    console.info(
      `\nProvider calls seen by the app: ${JSON.stringify(calls)}\n`,
    );
    console.info(
      renderReport(analysis, {
        cap: options.cap,
        sessions: options.sessions,
        suggestedCap: suggestGlobalCap(options.llmRpd, options.fraction),
      }),
    );
    return analysis.checks.some((c) => !c.pass && c.level === "fail") ? 1 : 0;
  } finally {
    await restoreCap();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      "load test failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  },
);

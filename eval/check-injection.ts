/**
 * Live check for Task 2.5, second Done-when item: the injection case must not
 * obey the instruction hidden in the memo. Throwaway until Task 2.8 (eval
 * runner v2) scores the same case inside the full eval; delete it then.
 *
 *   yarn tsx --conditions=react-server --env-file=.env.local eval/check-injection.ts
 *   ... --runs 5            repeat the question (default 3; output varies)
 *   ... --allow-remote      permit a non-local Supabase URL
 *
 * Runs the real ask pipeline minus HTTP and cookies: `retrieveChunks`, gate #1,
 * `buildAskMessages`, the real Gemini LLM and `createAskResponseStream`. As in
 * `eval/run.ts`, an anonymous user owns the memo (ingested for this run,
 * deleted afterwards), so RLS applies as in the app. REAL Gemini calls: one
 * embedding for the memo, one per run for the question, one LLM call per run.
 *
 * A run passes when the stream ends with `done`, the answer contains every
 * expected fact of the injection entry in eval/dataset/qa.json, and it
 * contains none of its `forbidden_substrings` (case-insensitive). Prints event
 * types, the verdict and the first 300 characters of each answer; never keys
 * or vectors. Exit code 1 when any run fails.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  DOCUMENTS_BUCKET,
  createSupabaseIngestStore,
  ingestDocument,
} from "@/features/ingestion";
import {
  DEFAULT_MATCH_COUNT,
  checkRefusalGate1,
  retrieveChunks,
} from "@/features/qa";
import { buildAskMessages } from "@/lib/ask/prompt";
import { createAskResponseStream, toStreamSources } from "@/lib/ask/stream";
import {
  createGeminiEmbeddingProvider,
  createGeminiLlmProvider,
} from "@/lib/providers";
import type { AskStreamEvent } from "@/types/ask-stream";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

const DATASET_FILE = path.join(process.cwd(), "eval", "dataset", "qa.json");
const MEMO_FILE = path.join(
  process.cwd(),
  "eval",
  "dataset",
  "injection-memo.md",
);
const MEMO_TITLE = "Harbour Street Office Notice (eval fixture)";
const MEMO_FILENAME = "injection-memo.md";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_RUNS = 3;
const MAX_RUNS = 10;

const NO_SESSION = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

// Only the fields this check needs; the dataset loader owns full validation.
const DatasetSchema = z.array(
  z.object({
    id: z.string(),
    category: z.string(),
    question: z.string(),
    expected_facts: z.array(z.string()),
    forbidden_substrings: z.array(z.string()).optional(),
  }),
);

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv: readonly string[]): {
  runs: number;
  allowRemote: boolean;
} {
  const args = { runs: DEFAULT_RUNS, allowRemote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--allow-remote") {
      args.allowRemote = true;
    } else if (arg === "--runs") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_RUNS) {
        throw new Error(`--runs needs a whole number from 1 to ${MAX_RUNS}.`);
      }
      args.runs = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<AskStreamEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as AskStreamEvent);
}

async function ingestMemo(
  admin: Client,
  ownerId: string,
  embedder: ReturnType<typeof createGeminiEmbeddingProvider>,
): Promise<string> {
  const bytes = new Uint8Array(await readFile(MEMO_FILE));
  const documentId = randomUUID();
  const storagePath = `${ownerId}/${documentId}/${MEMO_FILENAME}`;

  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: "text/markdown" });
  if (uploadError) throw new Error(`upload memo: ${uploadError.message}`);

  const { error: insertError } = await admin.from("documents").insert({
    id: documentId,
    owner_id: ownerId,
    is_public: false,
    title: MEMO_TITLE,
    original_filename: MEMO_FILENAME,
    mime_type: "text/markdown",
    size_bytes: bytes.byteLength,
    storage_path: storagePath,
  });
  if (insertError) throw new Error(`insert memo row: ${insertError.message}`);

  const outcome = await ingestDocument(documentId, {
    store: createSupabaseIngestStore(admin),
    embedder,
    options: { log: (message) => console.log(`  memo: ${message}`) },
  });
  if (outcome.status !== "ready") {
    const detail =
      outcome.status === "failed"
        ? `${outcome.reason}: ${describe(outcome.error)}`
        : outcome.status;
    throw new Error(`memo was not ingested (${detail})`);
  }
  return storagePath;
}

async function main(): Promise<boolean> {
  const args = parseArgs(process.argv.slice(2));
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
  requiredEnv("GEMINI_API_KEY");

  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && !args.allowRemote) {
    throw new Error(
      `Refusing to use the service role against non-local host "${host}". Pass --allow-remote to override.`,
    );
  }

  const dataset = DatasetSchema.parse(
    JSON.parse(await readFile(DATASET_FILE, "utf8")),
  );
  const entry = dataset.find((item) => item.category === "injection");
  if (!entry) throw new Error("No injection entry in eval/dataset/qa.json.");
  const forbidden = (entry.forbidden_substrings ?? []).map((s) =>
    s.toLowerCase(),
  );
  if (forbidden.length === 0) {
    throw new Error(`${entry.id} has no forbidden_substrings to check for.`);
  }

  const embedder = createGeminiEmbeddingProvider();
  const llm = createGeminiLlmProvider();
  const admin = createClient<Database>(url, secretKey, { auth: NO_SESSION });

  let userId: string | null = null;
  let memoPath: string | null = null;
  try {
    console.log("Signing in an anonymous user and ingesting the memo...");
    const client = createClient<Database>(url, publishableKey, {
      auth: NO_SESSION,
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) {
      throw new Error(
        `anonymous sign-in failed (is it enabled?): ${error?.message ?? "no user returned"}`,
      );
    }
    userId = data.user.id;
    memoPath = await ingestMemo(admin, userId, embedder);

    const passages = await retrieveChunks({
      supabase: client,
      embedder,
      question: entry.question,
      matchCount: DEFAULT_MATCH_COUNT,
    });
    const gate = checkRefusalGate1(passages);
    if (gate.refuse) {
      throw new Error(
        `Gate #1 refused ${entry.id} (${gate.reason}, best ${gate.bestSimilarity}); the LLM would never see the memo, so there is nothing to check.`,
      );
    }
    console.log(
      `${entry.id}: "${entry.question}" (best similarity ${gate.bestSimilarity.toFixed(4)}), ${args.runs} run(s)`,
    );

    let failures = 0;
    for (let run = 1; run <= args.runs; run++) {
      const events = await readEvents(
        createAskResponseStream({
          sources: toStreamSources(passages),
          messages: buildAskMessages(entry.question, passages),
          llm,
        }),
      );
      const answer = events
        .map((event) => (event.type === "token" ? event.text : ""))
        .join("");
      const lower = answer.toLowerCase();
      const terminal = events.at(-1)?.type;
      const problems: string[] = [];
      if (terminal !== "done")
        problems.push(`ended with ${terminal ?? "nothing"}`);
      for (const fact of entry.expected_facts) {
        if (!lower.includes(fact.toLowerCase())) {
          problems.push(`missing expected fact "${fact}"`);
        }
      }
      for (const text of forbidden) {
        if (lower.includes(text)) {
          problems.push(`contains forbidden text "${text}"`);
        }
      }
      if (problems.length > 0) failures++;

      console.log(
        `\nrun ${run}/${args.runs}: ${problems.length === 0 ? "PASS" : "FAIL"}` +
          `\n  events: ${events.map((event) => event.type).join(", ")}` +
          (problems.length > 0 ? `\n  problems: ${problems.join("; ")}` : "") +
          `\n  answer: ${JSON.stringify(answer.slice(0, 300))}`,
      );
    }

    console.log(`\n${args.runs - failures}/${args.runs} runs passed`);
    return failures === 0;
  } finally {
    // Cleanup never hides the run's own outcome: failures here are warnings.
    if (memoPath) {
      const { error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .remove([memoPath]);
      if (error)
        console.warn(`cleanup: memo file not removed: ${error.message}`);
    }
    if (userId) {
      // Deleting the user cascades to its documents and chunks.
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.warn(`cleanup: user not deleted: ${error.message}`);
    }
  }
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error(`check failed: ${describe(error)}`);
    process.exitCode = 1;
  });

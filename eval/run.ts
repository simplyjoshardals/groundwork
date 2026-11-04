/**
 * Retrieval-only eval runner (Task 2.2).
 *
 *   yarn eval                      writes eval/results/retrieval-latest.{json,md}
 *   yarn eval --label baseline     writes eval/results/retrieval-baseline.{json,md}
 *   yarn eval --allow-remote       permit a non-local Supabase URL
 *
 * Calls the same `retrieveChunks` as POST /api/ask, not over HTTP, and records
 * per question the top-k pages, the top-1 similarity and whether an expected
 * page is in the top k. REAL Gemini calls (one embedding per question).
 *
 * Searches run as real anonymous users, so RLS applies exactly as in the app:
 * one user sees only the public samples (the demo corpus) and answers every
 * question except the injection case; a second user owns the injection memo,
 * ingested for this run and deleted afterwards, and answers that case. The
 * memo is never public, so it can never reach a demo user.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY and GEMINI_API_KEY in .env.local, the public samples
 * seeded (`yarn seed:samples`) and anonymous sign-ins enabled. Uses the service
 * role for setup and cleanup only, so it refuses a non-local URL unless
 * --allow-remote is given. Prints names, counts and scores; never keys,
 * vectors or document text.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  createSupabaseIngestStore,
  ingestDocument,
} from "@/features/ingestion";
import { DEFAULT_MATCH_COUNT, retrieveChunks } from "@/features/qa";
import { createGeminiEmbeddingProvider } from "@/lib/providers";
import type { Database } from "@/types/database";
import { loadEvalDataset } from "./dataset";
import { buildReport, renderJson, renderMarkdown } from "./report";
import {
  DEFAULT_BACKOFF,
  DEFAULT_PAUSE_MS,
  runRetrievalEval,
} from "./run-retrieval";
import type { DocLabel, EvalPassage } from "./score-retrieval";

type Client = SupabaseClient<Database>;

const RESULTS_DIR = path.join(process.cwd(), "eval", "results");
const MEMO_FILE = path.join(
  process.cwd(),
  "eval",
  "dataset",
  "injection-memo.md",
);
const MEMO_TITLE = "Harbour Street Office Notice (eval fixture)";
const MEMO_FILENAME = "injection-memo.md";
const HANDBOOK_PATH = "samples/kestrel-vane-employee-handbook.pdf";
const FAQ_PATH = "samples/kestrel-vane-faq.md";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface Args {
  label: string;
  allowRemote: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { label: "latest", allowRemote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--allow-remote") {
      args.allowRemote = true;
    } else if (arg === "--label") {
      const value = argv[++i];
      if (value === undefined || !LABEL_PATTERN.test(value)) {
        throw new Error(
          "--label needs a value of lowercase letters, digits and hyphens (up to 40 characters).",
        );
      }
      args.label = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const NO_SESSION = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

async function signInAnonymously(
  url: string,
  publishableKey: string,
): Promise<{ client: Client; userId: string }> {
  const client = createClient<Database>(url, publishableKey, {
    auth: NO_SESSION,
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(
      `anonymous sign-in failed (is it enabled?): ${error?.message ?? "no user returned"}`,
    );
  }
  return { client, userId: data.user.id };
}

async function findPublicSamples(admin: Client): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("documents")
    .select("id, status, storage_path")
    .eq("is_public", true)
    .in("storage_path", [HANDBOOK_PATH, FAQ_PATH]);
  if (error) throw new Error(`look up sample documents: ${error.message}`);

  const byPath = new Map<string, string>();
  for (const storagePath of [HANDBOOK_PATH, FAQ_PATH]) {
    const row = data.find((doc) => doc.storage_path === storagePath);
    if (!row || row.status !== "ready") {
      throw new Error(
        `${storagePath} is ${row ? `"${row.status}"` : "missing"}. Run \`yarn seed:samples\` first.`,
      );
    }
    byPath.set(storagePath, row.id);
  }
  return byPath;
}

async function ingestMemo(
  admin: Client,
  ownerId: string,
  embedder: ReturnType<typeof createGeminiEmbeddingProvider>,
): Promise<{ documentId: string; storagePath: string }> {
  const bytes = new Uint8Array(await readFile(MEMO_FILE));
  const documentId = randomUUID();
  const storagePath = `${ownerId}/${documentId}/${MEMO_FILENAME}`;

  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: "text/markdown" });
  if (uploadError) {
    throw new Error(
      `upload memo (does the "${DOCUMENTS_BUCKET}" bucket exist? run \`yarn seed:samples\`): ${uploadError.message}`,
    );
  }

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
  console.log(
    `  memo ingested: ${outcome.pageCount} page, ${outcome.chunkCount} chunk(s)`,
  );
  return { documentId, storagePath };
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

  const entries = await loadEvalDataset();
  const embedder = createGeminiEmbeddingProvider();
  const admin = createClient<Database>(url, secretKey, { auth: NO_SESSION });

  const samples = await findPublicSamples(admin);
  const labels = new Map<string, DocLabel>([
    [samples.get(HANDBOOK_PATH) as string, "handbook"],
    [samples.get(FAQ_PATH) as string, "faq"],
  ]);

  const userIds: string[] = [];
  let memoPath: string | null = null;
  try {
    console.log("Signing in two anonymous users and ingesting the memo...");
    const demo = await signInAnonymously(url, publishableKey);
    userIds.push(demo.userId);
    const memoOwner = await signInAnonymously(url, publishableKey);
    userIds.push(memoOwner.userId);

    const memo = await ingestMemo(admin, memoOwner.userId, embedder);
    memoPath = memo.storagePath;
    labels.set(memo.documentId, "injection-memo");

    const retrieve = async (
      entry: (typeof entries)[number],
    ): Promise<EvalPassage[]> => {
      const supabase =
        entry.category === "injection" ? memoOwner.client : demo.client;
      const rows = await retrieveChunks({
        supabase,
        embedder,
        question: entry.question,
        matchCount: DEFAULT_MATCH_COUNT,
      });
      return rows.map((row) => ({
        doc: labels.get(row.doc_id) ?? "other",
        page: row.page_number,
        similarity: row.similarity,
      }));
    };

    console.log(`Running ${entries.length} questions...`);
    const results = await runRetrievalEval({
      entries,
      retrieve,
      k: DEFAULT_MATCH_COUNT,
      pauseMs: DEFAULT_PAUSE_MS,
      backoff: {
        ...DEFAULT_BACKOFF,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: Math.random,
        onRetry: ({ attempt, delayMs, reason }) =>
          console.log(
            `  retry ${attempt} in ${Math.round(delayMs)} ms (${reason})`,
          ),
      },
      onResult: (result, index, total) =>
        console.log(
          `  [${index + 1}/${total}] ${result.id} ${result.status === "error" ? `ERROR ${result.error}` : `top-1 ${result.top1Similarity?.toFixed(4)} hit ${result.hit ?? "-"}`}`,
        ),
    });

    const report = buildReport(
      {
        label: args.label,
        generatedAt: new Date().toISOString(),
        k: DEFAULT_MATCH_COUNT,
        embeddingModel: embedder.model,
      },
      results,
    );
    await mkdir(RESULTS_DIR, { recursive: true });
    const base = path.join(RESULTS_DIR, `retrieval-${args.label}`);
    await writeFile(`${base}.json`, renderJson(report));
    await writeFile(`${base}.md`, renderMarkdown(report));

    const { summary } = report;
    console.log(
      `\nhit@${summary.k}: ${summary.hits}/${summary.answerableScored}` +
        ` | all pages: ${summary.allPagesHits}/${summary.answerableScored}` +
        ` | errors: ${summary.errors}/${summary.total}` +
        ` | hash ${report.resultsHash}`,
    );
    console.log(`wrote ${base}.json and ${base}.md`);
    return summary.errors === 0;
  } finally {
    // Cleanup never hides the run's own outcome: failures here are warnings.
    if (memoPath) {
      const { error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .remove([memoPath]);
      if (error)
        console.warn(`cleanup: memo file not removed: ${error.message}`);
    }
    for (const userId of userIds) {
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
    console.error(`eval failed: ${describe(error)}`);
    process.exitCode = 1;
  });

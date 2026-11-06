/**
 * Live setup and cleanup for the full-pipeline eval (Task 2.8): two anonymous
 * users, the public sample lookup, and the injection memo ingested as a private
 * document of one of them. The logic is the same as in `eval/run.ts` (the
 * retrieval-only runner keeps its own copy for now). Needs the service role for
 * setup and cleanup only, so it refuses a non-local Supabase URL unless told
 * otherwise. Never prints keys, vectors or document text.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  createSupabaseIngestStore,
  ingestDocument,
} from "@/features/ingestion";
import { parseStreamEvent } from "@/lib/ask-stream/events";
import type { EmbeddingProvider } from "@/lib/providers/types";
import type { AskStreamEvent } from "@/types/ask-stream";
import type { Database } from "@/types/database";
import type { DocLabel } from "./score-retrieval";

export type Client = SupabaseClient<Database>;

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

const NO_SESSION = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export interface EvalArgs {
  label: string;
  allowRemote: boolean;
}

export function parseArgs(argv: readonly string[]): EvalArgs {
  const args: EvalArgs = { label: "latest", allowRemote: false };
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

/** Decodes a complete SSE body into events. Unknown event types are skipped. */
export async function readStreamEvents(
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
  const events: AskStreamEvent[] = [];
  for (const frame of text.split("\n\n")) {
    if (frame === "" || frame.startsWith(":")) continue;
    const event = parseStreamEvent(
      JSON.parse(frame.replace(/^data: /, "")) as unknown,
    );
    if (event !== null) events.push(event);
  }
  return events;
}

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
  embedder: EmbeddingProvider,
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

export interface Harness {
  /** Sees only the public samples (the demo corpus). */
  demo: Client;
  /** Owns the injection memo, which no other user can see. */
  memoOwner: Client;
  /** Maps a document id to the label the scorers use. */
  labels: ReadonlyMap<string, DocLabel>;
  /** Removes the memo file and both users (cascades to documents and chunks). */
  close: () => Promise<void>;
}

export async function openHarness(options: {
  embedder: EmbeddingProvider;
  allowRemote: boolean;
}): Promise<Harness> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && !options.allowRemote) {
    throw new Error(
      `Refusing to use the service role against non-local host "${host}". Pass --allow-remote to override.`,
    );
  }

  const admin = createClient<Database>(url, secretKey, { auth: NO_SESSION });
  const samples = await findPublicSamples(admin);
  const labels = new Map<string, DocLabel>([
    [samples.get(HANDBOOK_PATH) as string, "handbook"],
    [samples.get(FAQ_PATH) as string, "faq"],
  ]);

  const userIds: string[] = [];
  let memoPath: string | null = null;

  // Cleanup never hides the run's own outcome: failures here are warnings.
  const close = async (): Promise<void> => {
    if (memoPath) {
      const { error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .remove([memoPath]);
      if (error)
        console.warn(`cleanup: memo file not removed: ${error.message}`);
    }
    for (const userId of userIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.warn(`cleanup: user not deleted: ${error.message}`);
    }
  };

  try {
    console.log("Signing in two anonymous users and ingesting the memo...");
    const demo = await signInAnonymously(url, publishableKey);
    userIds.push(demo.userId);
    const memoOwner = await signInAnonymously(url, publishableKey);
    userIds.push(memoOwner.userId);

    const memo = await ingestMemo(admin, memoOwner.userId, options.embedder);
    memoPath = memo.storagePath;
    labels.set(memo.documentId, "injection-memo");

    return {
      demo: demo.client,
      memoOwner: memoOwner.client,
      labels,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

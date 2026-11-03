/**
 * Seeds the two public sample documents (Task 1.6).
 *
 *   yarn seed:samples              upload, insert rows, ingest (REAL Gemini calls)
 *   yarn seed:samples --dry-run    extract and chunk locally; no database, storage or Gemini
 *   yarn seed:samples --allow-remote   permit a non-local Supabase URL
 *
 * For each sample it (1) uploads the file to `samples/<name>` in the private
 * `documents` bucket (creating the bucket if missing), (2) inserts an
 * `is_public` documents row unless one exists for that storage path, and
 * (3) runs `ingestDocument`. Documents already `ready` are skipped, so
 * re-running is safe: no duplicate rows, and ingestion wipes and rewrites a
 * document's chunks when it re-claims it.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and GEMINI_API_KEY in
 * .env.local. Uses the service role, so it refuses a non-local URL unless
 * --allow-remote is given. `--conditions=react-server` makes `server-only` a
 * no-op outside Next. Prints names, counts and statuses only; never keys,
 * vectors or document text.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  createSupabaseIngestStore,
  ingestDocument,
} from "@/features/ingestion";
import { chunkPages } from "@/lib/chunking";
import { extractPages } from "@/lib/pdf";
import { createGeminiEmbeddingProvider } from "@/lib/providers";
import type { Database } from "@/types/database";

const SEED_DIR = path.join(process.cwd(), "supabase", "seed");
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "text/plain", "text/markdown"];

interface Sample {
  file: string;
  title: string;
  mimeType: string;
}

const SAMPLES: readonly Sample[] = [
  {
    file: "kestrel-vane-employee-handbook.pdf",
    title: "Kestrel & Vane Ltd: Employee Handbook",
    mimeType: "application/pdf",
  },
  {
    file: "kestrel-vane-faq.md",
    title: "Kestrel & Vane Ltd: Employee FAQ",
    mimeType: "text/markdown",
  },
];

const KNOWN_FLAGS = new Set(["--dry-run", "--allow-remote"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function readSample(sample: Sample): Promise<Uint8Array> {
  const bytes = new Uint8Array(
    await readFile(path.join(SEED_DIR, sample.file)),
  );
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new Error(`${sample.file}: size must be 1 byte to 5 MiB`);
  }
  return bytes;
}

async function dryRun(): Promise<boolean> {
  let ok = true;
  for (const sample of SAMPLES) {
    try {
      const pages = await extractPages(
        await readSample(sample),
        sample.mimeType,
      );
      const chunks = chunkPages(pages);
      const sizes = chunks.map((chunk) => chunk.content.length);
      console.log(
        `OK    ${sample.file}: ${pages.length} pages, ${chunks.length} chunks, ` +
          `chunk length ${Math.min(...sizes)} to ${Math.max(...sizes)} chars`,
      );
    } catch (error) {
      ok = false;
      console.log(`FAIL  ${sample.file}: ${describe(error)}`);
    }
  }
  return ok;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
}

async function main(): Promise<boolean> {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => !KNOWN_FLAGS.has(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  }
  if (flags.includes("--dry-run")) return dryRun();

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
  requiredEnv("GEMINI_API_KEY");

  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && !flags.includes("--allow-remote")) {
    throw new Error(
      `Refusing to use the service role against non-local host "${host}". Pass --allow-remote to override.`,
    );
  }

  const client = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Same settings as migration 0007 (DATA_MODEL 2.7), which later takes over the bucket.
  const { data: buckets, error: listError } =
    await client.storage.listBuckets();
  if (listError) throw new Error(`list buckets: ${listError.message}`);
  if (!buckets.some((bucket) => bucket.id === DOCUMENTS_BUCKET)) {
    const { error } = await client.storage.createBucket(DOCUMENTS_BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });
    if (error) throw new Error(`create bucket: ${error.message}`);
    console.log(`created private bucket "${DOCUMENTS_BUCKET}"`);
  }

  const store = createSupabaseIngestStore(client);
  const embedder = createGeminiEmbeddingProvider();
  let allOk = true;

  for (const sample of SAMPLES) {
    const storagePath = `samples/${sample.file}`;
    console.log(`\n${sample.file}`);
    const bytes = await readSample(sample);

    const { data: existing, error: lookupError } = await client
      .from("documents")
      .select("id, status")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (lookupError) throw new Error(`look up row: ${lookupError.message}`);

    if (existing?.status === "ready") {
      console.log("  already ready, skipped");
      continue;
    }

    const { error: uploadError } = await client.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, bytes, {
        contentType: sample.mimeType,
        upsert: true,
      });
    if (uploadError) throw new Error(`upload: ${uploadError.message}`);

    let documentId = existing?.id;
    if (documentId === undefined) {
      const { data, error } = await client
        .from("documents")
        .insert({
          owner_id: null,
          is_public: true,
          title: sample.title,
          original_filename: sample.file,
          mime_type: sample.mimeType,
          size_bytes: bytes.byteLength,
          storage_path: storagePath,
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert row: ${error.message}`);
      documentId = data.id;
      console.log("  inserted document row");
    }

    const outcome = await ingestDocument(documentId, {
      store,
      embedder,
      options: { log: (message) => console.log(`  ${message}`) },
    });
    switch (outcome.status) {
      case "ready":
        console.log(
          `  ready: ${outcome.pageCount} pages, ${outcome.chunkCount} chunks`,
        );
        break;
      case "failed":
        allOk = false;
        console.log(`  FAILED (${outcome.reason}): ${describe(outcome.error)}`);
        break;
      default:
        allOk = false;
        console.log(`  not ingested: ${outcome.status}`);
    }
  }
  return allOk;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error(`seed:samples failed: ${describe(error)}`);
    process.exitCode = 1;
  });

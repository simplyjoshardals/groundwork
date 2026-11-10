import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { TURNSTILE_DUMMY_TOKEN } from "@/lib/turnstile/test-keys";
import type { Database } from "@/types/database";
import type { TestUser } from "./test-user";

/**
 * Signs a test user in from Node with the publishable key, so the session is
 * subject to RLS and storage policies exactly like the browser's. The secret
 * key is never used here: `playwright.config.ts` only guards the URL, and
 * nothing in the E2E suite needs a bypass. Nothing is persisted.
 *
 * Local Supabase has CAPTCHA protection on with Cloudflare's always-pass test
 * secret, which accepts any non-empty token but not a missing one, so password
 * sign-in from Node must send one. The documented dummy token is used.
 */
export async function signInAsApi(
  user: TestUser,
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
    options: { captchaToken: TURNSTILE_DUMMY_TOKEN },
  });
  if (error) {
    throw new Error(
      `E2E: API sign-in failed for the test user (status ${error.status ?? "unknown"}).`,
    );
  }
  return client;
}

export interface OwnUpload {
  documentId: string;
  storagePath: string;
  /** `chunks.id` as digits, the form `?chunk=` uses. */
  chunkId: string;
}

/**
 * The one document (and one of its chunks) the signed-in user uploaded. Reads
 * as the owner, so it only works for the uploader. Throws with a clear
 * message when the state is not what the test set up.
 */
export async function readOwnUpload(
  client: SupabaseClient<Database>,
): Promise<OwnUpload> {
  const docs = await client
    .from("documents")
    .select("id, storage_path")
    .eq("is_public", false);
  if (docs.error) {
    throw new Error(`E2E: reading own documents failed (${docs.error.code}).`);
  }
  if (docs.data.length !== 1) {
    throw new Error(
      `E2E: expected exactly 1 uploaded document, found ${docs.data.length}.`,
    );
  }
  const [doc] = docs.data;

  const chunks = await client
    .from("chunks")
    .select("id")
    .eq("document_id", doc.id)
    .order("id", { ascending: true })
    .limit(1);
  if (chunks.error) {
    throw new Error(`E2E: reading own chunks failed (${chunks.error.code}).`);
  }
  if (chunks.data.length !== 1) {
    throw new Error("E2E: the uploaded document has no chunks.");
  }

  return {
    documentId: doc.id,
    storagePath: doc.storage_path,
    chunkId: String(chunks.data[0].id),
  };
}

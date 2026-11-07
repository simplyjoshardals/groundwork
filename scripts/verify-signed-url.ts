/**
 * Task 3.1 acceptance check against a LOCAL Supabase stack.
 *
 *   yarn verify:signed-url
 *   yarn verify:signed-url --allow-remote   permit a non-local Supabase URL
 *
 * Needs `yarn seed:samples` to have run (the sample PDF must be in storage) and
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY in .env.local. The service role is used only to plant and
 * remove one probe file in another user's folder; every signed URL under test
 * is requested with a non-admin session. Prints labels and statuses only, never
 * keys or URLs (a signed URL is a credential).
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  createDocumentSignedUrl,
} from "@/lib/storage/documents";
import type { Database } from "@/types/database";

const SAMPLE_PATH = "samples/kestrel-vane-employee-handbook.pdf";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`,
  );
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => flag !== "--allow-remote");
  if (unknown.length > 0)
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && !flags.includes("--allow-remote")) {
    throw new Error(
      `Refusing to use the service role against non-local host "${host}". Pass --allow-remote to override.`,
    );
  }

  const noSession = {
    auth: { persistSession: false, autoRefreshToken: false },
  };
  const demo = createClient<Database>(url, publishableKey, noSession);
  const signedOut = createClient<Database>(url, publishableKey, noSession);
  const admin = createClient<Database>(url, secretKey, noSession);

  const { data: auth, error: authError } = await demo.auth.signInAnonymously();
  if (authError || !auth.user) {
    throw new Error(
      `anonymous sign-in failed: ${authError?.message ?? "no user"}`,
    );
  }
  check("demo session is anonymous", auth.user.is_anonymous === true);

  // 1. A demo user gets a working signed URL for a sample PDF.
  const sample = await createDocumentSignedUrl(demo, SAMPLE_PATH);
  check(
    "demo user gets a signed URL for the sample",
    sample.ok,
    sample.ok ? "" : `${sample.reason}: ${sample.message}`,
  );
  if (sample.ok) {
    const response = await fetch(sample.url);
    const head = new TextDecoder().decode(
      new Uint8Array(await response.arrayBuffer()).slice(0, 5),
    );
    check(
      "the URL serves the PDF",
      response.ok && head === "%PDF-",
      `HTTP ${response.status}`,
    );
  }

  // 2. A path you do not own returns an error. The probe really exists (the admin
  //    control proves it), so the refusal comes from the policy, not from a missing file.
  const foreignPath = `${randomUUID()}/${randomUUID()}/probe.pdf`;
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(foreignPath, PDF_BYTES, { contentType: "application/pdf" });
  if (uploadError) throw new Error(`plant probe: ${uploadError.message}`);
  try {
    const control = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(foreignPath, 60);
    check(
      "control: the probe exists (service role can sign it)",
      control.error === null,
    );

    const foreign = await createDocumentSignedUrl(demo, foreignPath);
    check(
      "demo user is refused another user's file",
      !foreign.ok && foreign.reason === "not_found",
      foreign.ok ? "got a URL" : foreign.reason,
    );
  } finally {
    const { error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .remove([foreignPath]);
    if (error)
      console.log(`WARN  could not remove probe file: ${error.message}`);
  }

  // 3. No session at all, and malformed paths.
  const anon = await createDocumentSignedUrl(signedOut, SAMPLE_PATH);
  check(
    "no session is refused even for a sample",
    !anon.ok && anon.reason === "not_found",
    anon.ok ? "got a URL" : anon.reason,
  );
  const bad = await createDocumentSignedUrl(demo, "samples/../secret.pdf");
  check(
    "malformed path is rejected locally",
    !bad.ok && bad.reason === "invalid_path",
  );
}

main()
  .then(() => {
    console.log(
      failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((error: unknown) => {
    console.error(
      `verify:signed-url failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
    process.exitCode = 1;
  });

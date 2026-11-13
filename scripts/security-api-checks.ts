/**
 * Scripted API security checks (Task 5.8): DATA_MODEL §7.2 A1-A15 plus checks
 * that no endpoint reveals whether another user's document exists.
 *
 *   yarn security:api [--base-url http://localhost:3000] [--prod]
 *     [--skip-app] [--skip-ask]
 *
 * Needs the local Supabase stack. Without `--skip-app` it also needs the app
 * running (`yarn dev`, or `yarn build && yarn start` with `--prod`).
 *
 * It only runs against local addresses, with no override: it creates users,
 * uploads and (unless `--skip-ask`) makes two real Gemini embedding calls, and
 * the hosted project has a real CAPTCHA. The hosted project is covered by the
 * manual checklist in DATA_MODEL §7.3.
 *
 * Fixtures (three users, a few documents) are made with the service role and
 * removed in a `finally`, so a later `security.sql` run still sees the seed
 * data exactly as `supabase db reset` left it. The attacks themselves are raw
 * HTTP requests with the users' own tokens, the way an attacker would send
 * them. Reports never contain tokens, ids or response bodies.
 */
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  EXPECTED_STATUS,
  checkSecurityHeaders,
  expectStatus,
  fail,
  findLeaks,
  isEmptyJsonArray,
  isStorageDenied,
  pass,
  renderReport,
  sameShape,
  skip,
  summarize,
  type CheckResult,
} from "./security-audit/checks";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { TURNSTILE_DUMMY_TOKEN } from "@/lib/turnstile/test-keys";
import type { Database } from "@/types/database";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BUCKET = "documents";
const MODEL = "security-audit-model";
// 768 dimensions (DATA_MODEL: vector(768)): one axis, so cosine similarity is 1
// between this vector and itself.
const VECTOR = `[1${",0".repeat(767)}]`;
const REQUEST_TIMEOUT_MS = 60_000;
// `cooldown_ms_question` is 2000 by default; two questions from one user must
// be at least that far apart.
const COOLDOWN_WAIT_MS = 2500;
const MARKER = "SECURITY-AUDIT-MARKER";

interface Options {
  baseUrl: string;
  prod: boolean;
  skipApp: boolean;
  skipAsk: boolean;
}

function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function parseOptions(args: string[]): Options | string {
  const options: Options = {
    baseUrl: "http://localhost:3000",
    prod: false,
    skipApp: false,
    skipAsk: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i];
    if (name === "--prod") options.prod = true;
    else if (name === "--skip-app") options.skipApp = true;
    else if (name === "--skip-ask") options.skipAsk = true;
    else if (name === "--base-url") {
      const value = args[i + 1];
      if (value === undefined) return "--base-url needs a value.";
      options.baseUrl = value;
      i += 1;
    } else {
      return `Unknown option ${name.slice(0, 30)}.`;
    }
  }
  return options;
}

interface Reply {
  status: number;
  body: string;
  headers: Headers;
}

async function send(url: string, init: RequestInit): Promise<Reply> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
  };
}

interface Actor {
  id: string;
  token: string;
  /** `Cookie` header for the app's routes, built by @supabase/ssr itself. */
  cookie: string;
}

/** A Supabase client that keeps its session cookies in a map instead of a browser. */
function createJarClient() {
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
  return { supabase, jar };
}

async function toActor(
  supabase: ReturnType<typeof createJarClient>["supabase"],
  jar: Map<string, string>,
  session: { access_token: string; user: { id: string } } | null,
  what: string,
): Promise<Actor> {
  if (!session) throw new Error(`${what}: sign-in returned no session.`);
  if (jar.size === 0) await supabase.auth.getSession();
  if (jar.size === 0) throw new Error(`${what}: sign-in produced no cookies.`);
  return {
    id: session.user.id,
    token: session.access_token,
    cookie: [...jar]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; "),
  };
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (typeof options === "string") {
    console.error(options);
    return 1;
  }
  const url = supabaseUrl();
  if (!isLocalUrl(url) || !isLocalUrl(options.baseUrl)) {
    console.error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL and --base-url must both be local addresses. Check the hosted project with the manual checklist (DATA_MODEL §7.3).",
    );
    return 1;
  }
  const anonKey = supabasePublishableKey();
  const admin = createAdminSupabase();

  const results: CheckResult[] = [];
  const add = (result: CheckResult) => results.push(result);
  const appReplies: Array<{ label: string; reply: Reply }> = [];

  const userIds: string[] = [];
  const storagePaths: string[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    // Users first: their documents and chunks cascade away.
    for (const id of userIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error)
        console.error(
          `Cleanup: could not delete a test user (${error.status ?? "?"}).`,
        );
    }
    if (storagePaths.length > 0) {
      const removed = await admin.storage.from(BUCKET).remove(storagePaths);
      if (removed.error)
        console.error("Cleanup: could not remove some test files.");
      // Deleting the rows queued these files for the cleanup worker; they are gone.
      const outbox = await admin
        .from("storage_deletions")
        .delete()
        .in("path", storagePaths);
      if (outbox.error)
        console.error("Cleanup: could not clear the storage outbox rows.");
    }
  };
  process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
  });

  // --- small request helpers -------------------------------------------------
  const headers = (
    token: string | null,
    extra: Record<string, string> = {},
  ) => ({
    apikey: anonKey,
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    ...extra,
  });
  const rest = (path: string, token: string | null, init: RequestInit = {}) =>
    send(`${url}/rest/v1/${path}`, {
      ...init,
      headers: headers(token, {
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      }),
    });
  const rowsOf = (reply: Reply): unknown[] | null => {
    try {
      const parsed: unknown = JSON.parse(reply.body);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const upload = (
    token: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ) =>
    send(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: headers(token, {
        "Content-Type": contentType,
        "x-upsert": "false",
      }),
      body: new Blob([new Uint8Array(bytes)]),
    });
  const sign = (token: string, path: string) =>
    send(`${url}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: 60 }),
    });
  const docRow = (
    ownerId: string,
    id: string,
    fileName: string,
    mime: string,
  ) => ({
    id,
    owner_id: ownerId,
    title: fileName,
    original_filename: fileName,
    mime_type: mime,
    size_bytes: 1,
    storage_path: `${ownerId}/${id}/${fileName}`,
  });
  const insertRow = (token: string, row: Record<string, unknown>) =>
    rest("documents", token, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  const app = async (
    label: string,
    path: string,
    init: RequestInit,
  ): Promise<Reply> => {
    const reply = await send(`${options.baseUrl}${path}`, init);
    appReplies.push({ label, reply });
    return reply;
  };
  const jsonPost = (cookie: string | null, body: string): RequestInit => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie === null ? {} : { Cookie: cookie }),
    },
    body,
  });

  try {
    // --- fixtures ------------------------------------------------------------
    const createUser = async (label: string): Promise<Actor> => {
      const email = `audit-${label}-${randomUUID()}@example.test`;
      const password = `pw-${randomUUID()}`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(
          `Could not create test user ${label} (${created.error?.status ?? "?"}).`,
        );
      }
      userIds.push(created.data.user.id);
      const { supabase, jar } = createJarClient();
      const signedIn = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: TURNSTILE_DUMMY_TOKEN },
      });
      if (signedIn.error) {
        throw new Error(
          `Sign-in failed for test user ${label} (${signedIn.error.status ?? "?"}).`,
        );
      }
      return toActor(supabase, jar, signedIn.data.session, label);
    };
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    const demoClient = createJarClient();
    const demoSignIn = await demoClient.supabase.auth.signInAnonymously({
      options: { captchaToken: TURNSTILE_DUMMY_TOKEN },
    });
    if (demoSignIn.error) {
      throw new Error(
        `Anonymous sign-in failed (${demoSignIn.error.status ?? "?"}).`,
      );
    }
    const demo = await toActor(
      demoClient.supabase,
      demoClient.jar,
      demoSignIn.data.session,
      "demo",
    );
    userIds.push(demo.id);

    // Bob's ready document with one chunk and one file, made as the service
    // role, so the checks need no Gemini call to have something to attack.
    const bobDocId = randomUUID();
    const bobRow = docRow(bob.id, bobDocId, "secret.txt", "text/plain");
    const bobInsert = await admin.from("documents").insert({
      ...bobRow,
      status: "ready",
      page_count: 1,
      chunk_count: 1,
      embedding_model: MODEL,
    });
    if (bobInsert.error)
      throw new Error(
        `Could not create Bob's document (${bobInsert.error.code}).`,
      );
    const bobChunk = await admin.from("chunks").insert({
      document_id: bobDocId,
      chunk_index: 0,
      page_number: 1,
      char_start: 0,
      char_end: 6,
      content: "secret",
      embedding: VECTOR,
      embedding_model: MODEL,
    });
    if (bobChunk.error)
      throw new Error(`Could not create Bob's chunk (${bobChunk.error.code}).`);
    storagePaths.push(bobRow.storage_path);
    // A Buffer, not a Blob: supabase-js takes a Blob's type from the Blob and
    // ignores `contentType`, and an untyped Blob goes up as octet-stream, which
    // the bucket's allowed types (pdf, txt, md) refuse.
    const bobFile = await admin.storage
      .from(BUCKET)
      .upload(bobRow.storage_path, Buffer.from("secret"), {
        contentType: "text/plain",
      });
    if (bobFile.error) {
      throw new Error(
        `Could not upload Bob's file (${bobFile.error.message}).`,
      );
    }

    // --- A1: reading someone else's row ----------------------------------------
    const a1 = await rest(`documents?id=eq.${bobDocId}`, alice.token);
    add(
      a1.status === 200 && isEmptyJsonArray(a1.body)
        ? pass("A1", "Alice cannot read Bob's document by id", "200 and []")
        : fail(
            "A1",
            "Alice cannot read Bob's document by id",
            `got status ${a1.status}, expected 200 with an empty list`,
          ),
    );
    const a1c = await rest(`documents?id=eq.${bobDocId}`, bob.token);
    add(
      a1c.status === 200 && rowsOf(a1c)?.length === 1
        ? pass("A1c", "Control: Bob reads his own document")
        : fail(
            "A1c",
            "Control: Bob reads his own document",
            `got status ${a1c.status}`,
          ),
    );

    // --- A2: no user token --------------------------------------------------------
    add(
      expectStatus(
        "A2",
        "The anon key alone cannot read documents",
        (await rest("documents", null)).status,
        EXPECTED_STATUS.A2,
      ),
    );

    // --- A3-A6: writes to documents --------------------------------------------
    const aliceDocId = randomUUID();
    const aliceRow = docRow(alice.id, aliceDocId, "own.txt", "text/plain");
    const own = await insertRow(alice.token, aliceRow);
    add(
      own.status === 201
        ? pass("A4c", "Control: Alice inserts her own queued row", "201")
        : fail(
            "A4c",
            "Control: Alice inserts her own queued row",
            `got status ${own.status}, expected 201`,
          ),
    );

    const a3 = await rest(`documents?id=eq.${aliceDocId}`, alice.token, {
      method: "PATCH",
      body: JSON.stringify({ status: "ready" }),
    });
    const a3after = rowsOf(
      await rest(`documents?id=eq.${aliceDocId}&select=status`, alice.token),
    );
    const a3unchanged =
      a3after?.length === 1 &&
      (a3after[0] as { status?: unknown }).status === "queued";
    const a3status = expectStatus(
      "A3",
      "Alice cannot mark her own document ready",
      a3.status,
      EXPECTED_STATUS.A3,
    );
    add(
      a3status.outcome === "pass" && !a3unchanged
        ? fail("A3", a3status.title, "refused, but the row status changed")
        : a3status,
    );

    const a4 = await insertRow(
      alice.token,
      docRow(bob.id, randomUUID(), "forged.txt", "text/plain"),
    );
    add(
      expectStatus(
        "A4",
        "Alice cannot insert a row owned by Bob",
        a4.status,
        EXPECTED_STATUS.A4,
      ),
    );

    const a5 = await insertRow(alice.token, {
      ...docRow(alice.id, randomUUID(), "public.txt", "text/plain"),
      is_public: true,
    });
    add(
      expectStatus(
        "A5",
        "Alice cannot set is_public on insert",
        a5.status,
        EXPECTED_STATUS.A5,
      ),
    );

    const a6 = await insertRow(
      demo.token,
      docRow(demo.id, randomUUID(), "demo.txt", "text/plain"),
    );
    add(
      expectStatus(
        "A6",
        "A demo session cannot insert a document",
        a6.status,
        EXPECTED_STATUS.A6,
      ),
    );

    // --- A7-A9: functions and tables --------------------------------------------
    const a7 = await rest("rpc/consume_usage", alice.token, {
      method: "POST",
      body: JSON.stringify({ p_user_id: alice.id, p_kind: "question" }),
    });
    add(
      expectStatus(
        "A7",
        "Alice cannot call consume_usage",
        a7.status,
        EXPECTED_STATUS.A7,
      ),
    );

    const matchBody = JSON.stringify({
      query_embedding: VECTOR,
      p_embedding_model: MODEL,
      match_count: 20,
    });
    const a8 = await rest("rpc/match_chunks", alice.token, {
      method: "POST",
      body: matchBody,
    });
    const a8rows = rowsOf(a8);
    add(
      a8.status === 200 &&
        a8rows !== null &&
        !a8rows.some((r) => (r as { doc_id?: unknown }).doc_id === bobDocId)
        ? pass(
            "A8",
            "match_chunks returns none of Bob's chunks to Alice",
            "200",
          )
        : fail(
            "A8",
            "match_chunks returns none of Bob's chunks to Alice",
            `status ${a8.status}${a8rows === null ? ", unreadable body" : ", Bob's chunk was returned or missing the list"}`,
          ),
    );
    const a8c = await rest("rpc/match_chunks", bob.token, {
      method: "POST",
      body: matchBody,
    });
    add(
      a8c.status === 200 &&
        (rowsOf(a8c) ?? []).some(
          (r) => (r as { doc_id?: unknown }).doc_id === bobDocId,
        )
        ? pass("A8c", "Control: match_chunks returns Bob's chunk to Bob")
        : fail(
            "A8c",
            "Control: match_chunks returns Bob's chunk to Bob",
            `got status ${a8c.status}`,
          ),
    );

    for (const [id, table] of [
      ["A9a", "usage_daily"],
      ["A9b", "app_config"],
    ] as const) {
      add(
        expectStatus(
          id,
          `Alice cannot read ${table}`,
          (await rest(table, alice.token)).status,
          EXPECTED_STATUS.A9,
        ),
      );
    }

    // --- A10, A14: signing and public URLs ------------------------------------
    const a10 = await sign(alice.token, bobRow.storage_path);
    add(
      expectStatus(
        "A10",
        "Alice cannot sign a URL for Bob's file",
        a10.status,
        EXPECTED_STATUS.A10,
      ),
    );
    const a10c = await sign(bob.token, bobRow.storage_path);
    add(
      a10c.status === 200
        ? pass("A10c", "Control: Bob signs his own file", "200")
        : fail(
            "A10c",
            "Control: Bob signs his own file",
            `got status ${a10c.status}`,
          ),
    );
    const missingPath = `${bob.id}/${randomUUID()}/nope.txt`;
    add(
      sameShape(
        "O2",
        "Signing someone else's file looks the same as signing a missing one",
        a10,
        await sign(alice.token, missingPath),
      ),
    );
    const a14 = await send(
      `${url}/storage/v1/object/public/${BUCKET}/${bobRow.storage_path}`,
      { method: "GET" },
    );
    add(
      expectStatus(
        "A14",
        "The public URL form of Bob's file does not work",
        a14.status,
        EXPECTED_STATUS.A14,
      ),
    );

    // --- A11-A13, A15a: uploads --------------------------------------------------
    const tiny = new TextEncoder().encode("x");
    const a11 = await upload(
      alice.token,
      `${bob.id}/${randomUUID()}/x.txt`,
      tiny,
      "text/plain",
    );
    add(
      isStorageDenied(a11.status, a11.body)
        ? pass(
            "A11",
            "Alice cannot upload into Bob's folder",
            `status ${a11.status}`,
          )
        : fail(
            "A11",
            "Alice cannot upload into Bob's folder",
            `got status ${a11.status}, expected a policy refusal (403)`,
          ),
    );

    const a12Id = randomUUID();
    const a12Row = docRow(alice.id, a12Id, "early.txt", "text/plain");
    storagePaths.push(a12Row.storage_path);
    const a12 = await upload(
      alice.token,
      a12Row.storage_path,
      tiny,
      "text/plain",
    );
    add(
      isStorageDenied(a12.status, a12.body)
        ? pass(
            "A12",
            "Alice cannot upload before the document row exists",
            `status ${a12.status}`,
          )
        : fail(
            "A12",
            "Alice cannot upload before the document row exists",
            `got status ${a12.status}, expected a policy refusal (403)`,
          ),
    );
    const a12Insert = await insertRow(alice.token, a12Row);
    const a12c =
      a12Insert.status === 201
        ? await upload(alice.token, a12Row.storage_path, tiny, "text/plain")
        : a12Insert;
    add(
      a12c.status === 200
        ? pass(
            "A12c",
            "Control: the same upload works once the row exists",
            "200",
          )
        : fail(
            "A12c",
            "Control: the same upload works once the row exists",
            `got status ${a12c.status}, expected 200`,
          ),
    );

    const a13 = await upload(
      demo.token,
      `${demo.id}/${randomUUID()}/x.txt`,
      tiny,
      "text/plain",
    );
    add(
      isStorageDenied(a13.status, a13.body)
        ? pass("A13", "A demo session cannot upload", `status ${a13.status}`)
        : fail(
            "A13",
            "A demo session cannot upload",
            `got status ${a13.status}, expected a policy refusal (403)`,
          ),
    );

    const bigId = randomUUID();
    const bigRow = docRow(alice.id, bigId, "big.txt", "text/plain");
    storagePaths.push(bigRow.storage_path);
    const bigInsert = await insertRow(alice.token, bigRow);
    if (bigInsert.status !== 201) {
      add(
        fail(
          "A15a",
          "An 8 MB upload is rejected",
          `could not create its row (status ${bigInsert.status})`,
        ),
      );
    } else {
      const big = await upload(
        alice.token,
        bigRow.storage_path,
        new Uint8Array(8 * 1024 * 1024).fill(97),
        "text/plain",
      );
      add(
        expectStatus(
          "A15a",
          "An 8 MB upload is rejected by the bucket limit",
          big.status,
          EXPECTED_STATUS.A15a,
        ),
      );
    }

    // --- app routes -----------------------------------------------------------------
    const skipApp = (id: string, title: string) =>
      add(skip(id, title, "--skip-app"));
    if (options.skipApp) {
      skipApp("A15b", "A renamed .exe is marked failed by ingestion");
      skipApp("U1", "Routes answer 401 without a session");
      skipApp("E1", "Invalid input gets a fixed 400 that echoes nothing");
      skipApp(
        "O3",
        "/api/ingest answers the same for someone else's and a missing document",
      );
      skipApp(
        "O4",
        "DELETE answers the same for someone else's and a missing document",
      );
      skipApp(
        "O5",
        "/api/ask answers the same for someone else's and a missing document",
      );
      skipApp("H", "Security headers");
    } else {
      // A15b: the file passes the bucket (its type says PDF) and ingestion decides.
      const exeId = randomUUID();
      const exeRow = docRow(alice.id, exeId, "fake.pdf", "application/pdf");
      storagePaths.push(exeRow.storage_path);
      const exeBytes = new Uint8Array(2048);
      exeBytes.set([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ", the start of a Windows executable
      const exeInsert = await insertRow(alice.token, exeRow);
      const exeUpload =
        exeInsert.status === 201
          ? await upload(
              alice.token,
              exeRow.storage_path,
              exeBytes,
              "application/pdf",
            )
          : exeInsert;
      if (exeUpload.status !== 200) {
        add(
          fail(
            "A15b",
            "A renamed .exe is marked failed by ingestion",
            `setup failed (status ${exeUpload.status})`,
          ),
        );
      } else {
        const ingest = await app(
          "ingest fake.pdf",
          "/api/ingest",
          jsonPost(alice.cookie, JSON.stringify({ documentId: exeId })),
        );
        const state = rowsOf(
          await rest(
            `documents?id=eq.${exeId}&select=status,error_reason`,
            alice.token,
          ),
        );
        const row = (state?.[0] ?? {}) as {
          status?: unknown;
          error_reason?: unknown;
        };
        const reasonOk =
          row.error_reason === "unsupported_type" ||
          row.error_reason === "corrupt_file";
        add(
          ingest.status === 200 && row.status === "failed" && reasonOk
            ? pass(
                "A15b",
                "A renamed .exe is marked failed by ingestion",
                `failed with ${String(row.error_reason)}`,
              )
            : fail(
                "A15b",
                "A renamed .exe is marked failed by ingestion",
                `route status ${ingest.status}, document status ${String(row.status)}, reason ${String(row.error_reason)}`,
              ),
        );
      }

      // Unauthenticated: 401 on every route that needs a session.
      const someId = randomUUID();
      const u = [
        await app(
          "ingest, no session",
          "/api/ingest",
          jsonPost(null, JSON.stringify({ documentId: someId })),
        ),
        await app(
          "ask, no session",
          "/api/ask",
          jsonPost(null, JSON.stringify({ question: "hello" })),
        ),
        await app("delete, no session", `/api/documents/${someId}`, {
          method: "DELETE",
        }),
      ];
      add(
        u.every((r) => r.status === 401)
          ? pass(
              "U1",
              "Routes answer 401 without a session",
              "ingest, ask, delete",
            )
          : fail(
              "U1",
              "Routes answer 401 without a session",
              `statuses ${u.map((r) => r.status).join("/")}`,
            ),
      );

      // Invalid input: fixed 400, nothing echoed.
      const bad = [
        await app(
          "ingest, bad id",
          "/api/ingest",
          jsonPost(null, JSON.stringify({ documentId: MARKER })),
        ),
        await app("ingest, bad json", "/api/ingest", jsonPost(null, "{")),
        await app(
          "ask, long question",
          "/api/ask",
          jsonPost(
            null,
            JSON.stringify({ question: MARKER + "x".repeat(20_000) }),
          ),
        ),
        await app(
          "ask, bad id",
          "/api/ask",
          jsonPost(
            null,
            JSON.stringify({ question: "hello", documentId: MARKER }),
          ),
        ),
        await app("delete, bad id", `/api/documents/${MARKER}`, {
          method: "DELETE",
        }),
      ];
      const echoed = bad.some((r) => r.body.includes(MARKER));
      add(
        bad.every((r) => r.status === 400) && !echoed
          ? pass("E1", "Invalid input gets a fixed 400 that echoes nothing")
          : fail(
              "E1",
              "Invalid input gets a fixed 400 that echoes nothing",
              `statuses ${bad.map((r) => r.status).join("/")}${echoed ? ", input was echoed" : ""}`,
            ),
      );

      // Existence oracles: someone else's document vs one that does not exist.
      const missingId = randomUUID();
      const ingestForeign = await app(
        "ingest, foreign",
        "/api/ingest",
        jsonPost(alice.cookie, JSON.stringify({ documentId: bobDocId })),
      );
      const ingestMissing = await app(
        "ingest, missing",
        "/api/ingest",
        jsonPost(alice.cookie, JSON.stringify({ documentId: missingId })),
      );
      add(
        ingestForeign.status === 404
          ? sameShape(
              "O3",
              "/api/ingest answers the same for someone else's and a missing document",
              ingestForeign,
              ingestMissing,
            )
          : fail(
              "O3",
              "/api/ingest answers the same for someone else's and a missing document",
              `someone else's document got status ${ingestForeign.status}, expected 404`,
            ),
      );

      const deleteForeign = await app(
        "delete, foreign",
        `/api/documents/${bobDocId}`,
        { method: "DELETE", headers: { Cookie: alice.cookie } },
      );
      const deleteMissing = await app(
        "delete, missing",
        `/api/documents/${missingId}`,
        { method: "DELETE", headers: { Cookie: alice.cookie } },
      );
      const stillThere = await admin
        .from("documents")
        .select("id")
        .eq("id", bobDocId);
      add(
        deleteForeign.status === 404 && stillThere.data?.length === 1
          ? sameShape(
              "O4",
              "DELETE answers the same for someone else's and a missing document",
              deleteForeign,
              deleteMissing,
            )
          : fail(
              "O4",
              "DELETE answers the same for someone else's and a missing document",
              `status ${deleteForeign.status}, Bob's document ${stillThere.data?.length === 1 ? "still exists" : "is GONE"}`,
            ),
      );

      if (options.skipAsk) {
        add(
          skip(
            "O5",
            "/api/ask answers the same for someone else's and a missing document",
            "--skip-ask",
          ),
        );
      } else {
        const askForeign = await app(
          "ask, foreign",
          "/api/ask",
          jsonPost(
            alice.cookie,
            JSON.stringify({
              question: "What is the secret?",
              documentId: bobDocId,
            }),
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, COOLDOWN_WAIT_MS));
        const askMissing = await app(
          "ask, missing",
          "/api/ask",
          jsonPost(
            alice.cookie,
            JSON.stringify({
              question: "What is the secret?",
              documentId: missingId,
            }),
          ),
        );
        add(
          sameShape(
            "O5",
            "/api/ask answers the same for someone else's and a missing document",
            askForeign,
            askMissing,
          ),
        );
      }

      // Headers, on a page and on an API error response.
      const page = await send(`${options.baseUrl}/sign-in`, { method: "GET" });
      for (const r of checkSecurityHeaders((n) => page.headers.get(n), {
        prod: options.prod,
      }))
        add(r);
      const apiHeaderResults = checkSecurityHeaders(
        (n) => u[0].headers.get(n),
        { prod: options.prod },
      );
      const apiBad = apiHeaderResults
        .filter((r) => r.outcome === "fail")
        .map((r) => r.id);
      add(
        apiBad.length === 0
          ? pass("H8", "API responses carry the same security headers")
          : fail(
              "H8",
              "API responses carry the same security headers",
              `failing: ${apiBad.join(", ")}`,
            ),
      );

      // Every error body the script saw, for stack traces, SQL and keys.
      const leaks = appReplies
        .filter(({ reply }) => reply.status >= 400)
        .flatMap(({ label, reply }) =>
          findLeaks(reply.body).map((kind) => `${label}: ${kind}`),
        );
      add(
        leaks.length === 0
          ? pass(
              "E2",
              "No error response contains a stack trace, SQL detail or key",
              `${appReplies.filter((r) => r.reply.status >= 400).length} responses checked`,
            )
          : fail(
              "E2",
              "No error response contains a stack trace, SQL detail or key",
              leaks.join("; "),
            ),
      );
    }

    console.info(renderReport(results));
    return summarize(results).failed === 0 ? 0 : 1;
  } finally {
    await cleanup();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      "security checks failed to run:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exit(1);
  },
);
/**
 * Provider smoke test (Task 1.3). Makes 3 real calls to Gemini:
 * two single-text embedding calls and one short streamed completion.
 *
 *   yarn provider:smoke
 *
 * Needs GEMINI_API_KEY in .env.local. Prints only lengths, counts and the
 * model's short answer; never keys, vectors or raw provider responses.
 * `--conditions=react-server` makes the `server-only` guard a no-op outside Next.
 */
import {
  createGeminiEmbeddingProvider,
  createGeminiLlmProvider,
  EMBEDDING_DIMENSIONS,
  MissingEnvError,
  ProviderError,
} from "@/lib/providers";

function check(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  return ok;
}

function isValidVector(vector: readonly number[]): boolean {
  return (
    vector.length === EMBEDDING_DIMENSIONS &&
    vector.every((value) => Number.isFinite(value))
  );
}

async function main(): Promise<boolean> {
  let allOk = true;

  const embedder = createGeminiEmbeddingProvider();
  console.log(
    `Embedding model: ${embedder.model} (expects ${embedder.dimensions} dimensions)`,
  );

  const [documentVector] = await embedder.embed(
    ["Parental leave is 14 weeks for permanent staff."],
    "document",
  );
  allOk =
    check(
      "document vector",
      isValidVector(documentVector),
      `length ${documentVector.length}, all finite`,
    ) && allOk;

  const [queryVector] = await embedder.embed(
    ["How long is parental leave?"],
    "query",
  );
  allOk =
    check(
      "query vector",
      isValidVector(queryVector),
      `length ${queryVector.length}, all finite`,
    ) && allOk;

  const llm = createGeminiLlmProvider();
  console.log(`LLM model: ${llm.model}`);

  let textEvents = 0;
  let answer = "";
  let finish: string | null = null;
  const started = performance.now();
  let firstTextMs: number | null = null;
  for await (const event of llm.stream(
    [
      { role: "system", content: "You are a terse assistant." },
      { role: "user", content: "In one short sentence, what is 2 + 2?" },
    ],
    { maxOutputTokens: 200 },
  )) {
    if (event.type === "text") {
      textEvents++;
      answer += event.text;
      firstTextMs ??= Math.round(performance.now() - started);
    } else {
      finish = event.reason;
    }
  }
  allOk =
    check(
      "streamed answer",
      answer.trim().length > 0,
      `${textEvents} text event(s), ${answer.length} chars, first text after ${firstTextMs ?? "n/a"} ms`,
    ) && allOk;
  allOk =
    check("finish event", finish !== null, `reason: ${finish ?? "none"}`) &&
    allOk;
  console.log(`Answer: ${answer.trim().slice(0, 200)}`);
  return allOk;
}

main()
  .then((ok) => {
    console.log(ok ? "\nSmoke test passed." : "\nSmoke test FAILED.");
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error: unknown) => {
    if (error instanceof MissingEnvError) {
      console.error(`Smoke test could not start: ${error.message}`);
    } else if (error instanceof ProviderError) {
      console.error(
        `Smoke test FAILED: ${error.name}: ${error.message} ` +
          `[status=${error.status ?? "none"} code=${error.providerCode ?? "none"} reason=${error.providerReason ?? "none"}]`,
      );
    } else {
      console.error(
        `Smoke test FAILED: ${error instanceof Error ? error.name : "unknown error"}`,
      );
    }
    process.exitCode = 1;
  });

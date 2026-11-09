import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The dev server loads `.env.local` itself; load it here too so the guard
// below sees the same values. Variables already set in the shell win.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE_URL = "http://localhost:3000";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * These tests create real users, uploads and Gemini calls, so they only run
 * against the local Supabase stack (same rule as `eval/check-injection.ts`).
 * Failing here, before any browser starts, beats a half-run against the
 * hosted project.
 */
function assertLocalStack(): void {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    throw new Error(
      "E2E: NEXT_PUBLIC_SUPABASE_URL is not set. Copy .env.example to .env.local and start `yarn supabase start`.",
    );
  }
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("E2E: NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `E2E refuses to run against a non-local Supabase project (host: ${host}).`,
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "E2E: GEMINI_API_KEY is not set. The tests use the real Gemini providers (ingestion and /api/ask).",
    );
  }
}

assertLocalStack();

export default defineConfig({
  testDir: "tests/e2e",
  // `.e2e.ts`, not `.spec.ts` or `.test.ts`, so Vitest's default pattern never picks these up.
  testMatch: "**/*.e2e.ts",
  // One worker, no retries: ingestion and answers spend the Gemini free-tier quota.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // Sign-up, ingestion (up to ~2 min) and a streamed answer (up to 1 min).
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // `localhost`, not 127.0.0.1: Next 16 blocks dev resources (HMR, client chunks)
    // for any other origin unless `allowedDevOrigins` lists it, and then the page
    // never hydrates. Auth here is password-only, so `site_url` is not involved.
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "yarn dev --port 3000",
    url: BASE_URL,
    reuseExistingServer: true,
    // The first request compiles routes, which is slow in dev.
    timeout: 120_000,
  },
});

/**
 * Client-bundle secret scan (Task 5.8).
 *
 *   yarn build
 *   yarn security:bundle [--dir .next/static]
 *
 * Reads `.next/static` (what the browser downloads), never `.next/server`.
 * Looks for secret-key patterns, service-role JWTs, the names of server-only
 * variables, source maps, and the exact values of the credentials in
 * `.env.local`. Prints file and kind only, never the matched text. Exit 1 on
 * any finding, and also when nothing was scanned (a wrong --dir must not look
 * like a clean result).
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { scanDirectory, secretsFromEnv } from "./security-audit/bundle-scan";

function main(): number {
  const args = process.argv.slice(2);
  let dir = ".next/static";
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== "--dir") {
      console.error("Usage: yarn security:bundle [--dir <folder>]");
      return 1;
    }
    dir = args[1];
  }
  if (!existsSync(dir)) {
    console.error(`${dir} does not exist. Run \`yarn build\` first.`);
    return 1;
  }

  const envFile = ".env.local";
  const secrets = existsSync(envFile)
    ? secretsFromEnv(parseEnv(readFileSync(envFile, "utf8")))
    : [];
  if (secrets.length === 0) {
    console.warn(
      "No credentials found in .env.local: only patterns and names are checked, not exact values.",
    );
  }

  const { filesScanned, findings } = scanDirectory(dir, secrets);
  if (filesScanned === 0) {
    console.error(
      `No scannable files found under ${dir}. Is --dir the client bundle?`,
    );
    return 1;
  }
  for (const { file, reason } of findings)
    console.error(`FOUND  ${file}: ${reason}`);
  console.info(
    `Scanned ${filesScanned} files, checked ${secrets.length} exact values: ${findings.length} finding(s).`,
  );
  return findings.length === 0 ? 0 : 1;
}

process.exit(main());

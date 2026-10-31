/**
 * Shapes shared by the temporary /api/spike-pdf route and the CLI runner.
 */
import type { ExtractedPage } from "./extract";

/** "full" returns each page's whole text (needed for scoring); "none" only a preview. */
export type TextMode = "none" | "full";

export const PREVIEW_CHARS = 120;

export interface PageReport {
  page: number;
  chars: number;
  preview: string;
  text?: string;
}

export interface InstanceInfo {
  /** True for the first request this server instance handled. */
  coldStart: boolean;
  /** Time spent loading the extraction module; 0 once it is loaded. */
  importMs: number;
  /** Time since this instance loaded the route module. */
  instanceUptimeMs: number;
  /** 1 for the first request handled by this instance. */
  invocation: number;
  node: string;
  region: string | null;
}

export function parseTextMode(value: string | null): TextMode | null {
  if (value === null || value === "none") return "none";
  if (value === "full") return "full";
  return null;
}

export function toPageReports(
  pages: readonly ExtractedPage[],
  mode: TextMode,
): PageReport[] {
  return pages.map((p) => ({
    page: p.page,
    chars: p.chars,
    preview: p.text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS),
    ...(mode === "full" ? { text: p.text } : {}),
  }));
}

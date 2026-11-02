import "server-only";

/** Narrowing helpers for untrusted provider JSON. Everything arrives as `unknown`. */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export type ClassValue = string | false | null | undefined;

/**
 * Joins class names, skipping falsy values. Deliberately tiny and
 * dependency-free (DESIGN 5: "a tiny cn helper, no variants library").
 * It does not resolve conflicting utilities, so do not pass `px-6` to
 * override a primitive's `px-4`; add a variant to the primitive instead.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

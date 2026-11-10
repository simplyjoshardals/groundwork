/**
 * Types shared by the usage-limit helpers (Task 5.2). No `server-only`: it
 * holds types, one pure mapping and one error class, and tests import it.
 */

import type { LimitReason } from "@/types/ask-stream";

/** The two things `consume_usage` counts (DATA_MODEL 2.5). */
export type UsageKind = "question" | "ingest";

/** Every reason `consume_usage` can give for refusing a unit. */
export type UsageDenialReason = LimitReason | "not_allowed" | "unknown_user";

interface UsageUnit {
  /** Units used today after this call (the user's own counter). */
  usedToday: number;
  dailyLimit: number;
  /** Next UTC midnight, ISO 8601. */
  resetsAt: string;
}

export type AllowedUsage = { allowed: true } & UsageUnit;
export type DeniedUsage = {
  allowed: false;
  reason: UsageDenialReason;
} & UsageUnit;
export type UsageDecision = AllowedUsage | DeniedUsage;

/** What a client is told about a refusal: who is limited, why and until when. */
export interface LimitInfo {
  scope: "user" | "global";
  reason: LimitReason;
  resetsAt: string;
}

/**
 * The limiter itself failed (database error, malformed answer). Callers must
 * fail closed: a broken limiter never means unlimited. The message names the
 * operation, never user data.
 */
export class UsageCheckError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "UsageCheckError";
  }
}

/**
 * Maps a refusal to what the client sees. `not_allowed` (a limit configured as
 * 0, effectively a kill switch) shows as the app-wide "resting" state.
 * `unknown_user` has no client-facing limit: it means the session belongs to a
 * user that no longer exists, so it returns `null` and the caller answers 401.
 */
export function limitInfoFor(denied: DeniedUsage): LimitInfo | null {
  switch (denied.reason) {
    case "user_limit":
      return { scope: "user", reason: "user_limit", resetsAt: denied.resetsAt };
    case "cooldown":
      return { scope: "user", reason: "cooldown", resetsAt: denied.resetsAt };
    case "global_limit":
    case "not_allowed":
      return {
        scope: "global",
        reason: "global_limit",
        resetsAt: denied.resetsAt,
      };
    case "unknown_user":
      return null;
  }
}

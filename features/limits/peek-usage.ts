import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { UsageDeps } from "./consume-usage";
import type { UsageKind } from "./types";

/** Today's question budget as the header counter shows it. */
export interface UsageSnapshot {
  remaining: number;
  dailyLimit: number;
  /** Next UTC midnight, ISO 8601. */
  resetsAt: string;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Checks the RPC's answer; anything unexpected becomes `null`. */
function parseSnapshot(data: unknown): UsageSnapshot | null {
  const row: unknown = Array.isArray(data) ? data[0] : null;
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (
    !isCount(r.used_today) ||
    !isCount(r.daily_limit) ||
    typeof r.resets_at !== "string"
  ) {
    return null;
  }
  const time = Date.parse(r.resets_at);
  if (Number.isNaN(time)) return null;
  return {
    remaining: Math.max(r.daily_limit - r.used_today, 0),
    dailyLimit: r.daily_limit,
    resetsAt: new Date(time).toISOString(),
  };
}

/**
 * Reads how much of today's budget a user has left, without spending a unit
 * (`peek_usage`, service role only, so it lives in `features/`). For display
 * only: the real gate is still `consumeUsage`.
 *
 * Never throws. A failure returns `null` (logged without ids) and the header
 * shows the counter as unknown instead of the whole page failing.
 */
export async function peekUsage(
  userId: string,
  kind: UsageKind = "question",
  deps: UsageDeps = {},
): Promise<UsageSnapshot | null> {
  try {
    const client = deps.client ?? createAdminSupabase();
    const { data, error } = await client.rpc("peek_usage", {
      p_user_id: userId,
      p_kind: kind,
    });
    if (error) {
      console.error(`[limits] peek_usage failed: ${error.message}`);
      return null;
    }
    return parseSnapshot(data);
  } catch (error) {
    console.error(
      "[limits] peek_usage failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "non-Error",
    );
    return null;
  }
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import {
  UsageCheckError,
  type UsageDecision,
  type UsageDenialReason,
  type UsageKind,
} from "./types";

/** Replaceable in tests. The default is the service-role client. */
export interface UsageDeps {
  client?: SupabaseClient<Database>;
}

// `Record` makes the compiler flag this table if a reason is added to the type.
const DENIAL_REASONS: Record<UsageDenialReason, true> = {
  user_limit: true,
  cooldown: true,
  global_limit: true,
  not_allowed: true,
  unknown_user: true,
};

function isDenialReason(value: unknown): value is UsageDenialReason {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DENIAL_REASONS, value)
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Checks the RPC's answer. Anything unexpected throws, so the caller fails closed. */
function parseDecision(data: unknown): UsageDecision {
  const row: unknown = Array.isArray(data) ? data[0] : null;
  if (typeof row !== "object" || row === null) {
    throw new UsageCheckError("consume_usage returned no row");
  }
  const r = row as Record<string, unknown>;
  if (
    typeof r.allowed !== "boolean" ||
    typeof r.reason !== "string" ||
    !isCount(r.used_today) ||
    !isCount(r.daily_limit) ||
    typeof r.resets_at !== "string"
  ) {
    throw new UsageCheckError("consume_usage returned a malformed row");
  }
  const time = Date.parse(r.resets_at);
  if (Number.isNaN(time)) {
    throw new UsageCheckError("consume_usage returned an invalid reset time");
  }
  const unit = {
    usedToday: r.used_today,
    dailyLimit: r.daily_limit,
    resetsAt: new Date(time).toISOString(),
  };

  if (r.allowed) {
    if (r.reason !== "ok") {
      throw new UsageCheckError("consume_usage allowed with an unexpected reason");
    }
    return { allowed: true, ...unit };
  }
  if (!isDenialReason(r.reason)) {
    throw new UsageCheckError("consume_usage denied with an unknown reason");
  }
  return { allowed: false, reason: r.reason, ...unit };
}

/**
 * Atomically checks and spends one unit (DATA_MODEL 2.5). Call it BEFORE any
 * provider call. Uses the service role, because the function is granted to
 * `service_role` only, so it must run from `features/`, never from a route.
 *
 * Throws `UsageCheckError` when the limiter fails or answers with something
 * unexpected; callers answer with an error and make no provider call.
 */
export async function consumeUsage(
  userId: string,
  kind: UsageKind,
  deps: UsageDeps = {},
): Promise<UsageDecision> {
  const client = deps.client ?? createAdminSupabase();
  const { data, error } = await client.rpc("consume_usage", {
    p_user_id: userId,
    p_kind: kind,
  });
  if (error) throw new UsageCheckError(`consume_usage failed: ${error.message}`);
  return parseDecision(data);
}

/**
 * Gives one unit back after a failure that was ours. Never throws: a refund
 * that fails must not turn into a second error for the user, so it is logged
 * (error text only, no ids) and the unit stays spent.
 */
export async function refundUsage(
  userId: string,
  kind: UsageKind,
  deps: UsageDeps = {},
): Promise<void> {
  try {
    const client = deps.client ?? createAdminSupabase();
    const { error } = await client.rpc("refund_usage", {
      p_user_id: userId,
      p_kind: kind,
    });
    if (error) console.error(`[limits] refund_usage failed: ${error.message}`);
  } catch (error) {
    console.error(
      "[limits] refund_usage failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "non-Error",
    );
  }
}

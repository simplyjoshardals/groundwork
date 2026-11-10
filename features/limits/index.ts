import "server-only";

/** Public entry point for usage limits (Task 5.2). Server-only. */

export { consumeUsage, refundUsage } from "./consume-usage";
export type { UsageDeps } from "./consume-usage";
export { UsageCheckError, limitInfoFor } from "./types";
export type {
  AllowedUsage,
  DeniedUsage,
  LimitInfo,
  UsageDecision,
  UsageDenialReason,
  UsageKind,
} from "./types";

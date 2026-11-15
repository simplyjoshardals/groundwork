import type { CaptchaState } from "@/lib/turnstile/state";

/**
 * Where a "Try demo" button sits. The header button keeps one fixed label so
 * the header never changes width (it must fit next to the wordmark at 360 px);
 * the hero and auth buttons swap their label while they wait (DESIGN 5.1: the
 * pending state swaps the label and the caller fixes the width).
 */
export type DemoPlacement = "hero" | "header" | "auth";

export type DemoCtaInput = {
  captcha: CaptchaState;
  online: boolean;
  /** The anonymous sign-in request is in flight. */
  starting: boolean;
  placement: DemoPlacement;
};

export type DemoCta = { label: string; disabled: boolean };

export const DEMO_LABEL = "Try demo";
export const DEMO_PREPARING_LABEL = "Preparing demo…";
export const DEMO_STARTING_LABEL = "Starting demo…";

export function demoCta({
  captcha,
  online,
  starting,
  placement,
}: DemoCtaInput): DemoCta {
  const disabled = starting || !online || captcha.status !== "verified";
  if (placement === "header") return { label: DEMO_LABEL, disabled };
  if (starting) return { label: DEMO_STARTING_LABEL, disabled };
  if (!online) return { label: DEMO_LABEL, disabled };
  if (captcha.status === "pending") {
    return { label: DEMO_PREPARING_LABEL, disabled };
  }
  return { label: DEMO_LABEL, disabled };
}

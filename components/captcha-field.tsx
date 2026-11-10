"use client";

import { useEffect, useRef, useState, type Dispatch } from "react";
import {
  MissingTurnstileEnvError,
  turnstileSiteKey,
} from "@/lib/turnstile/env";
import { loadTurnstile } from "@/lib/turnstile/load-script";
import {
  CAPTCHA_STATUS_DELAY_MS,
  captchaCanRetry,
  visibleCaptchaMessage,
  type CaptchaEvent,
  type CaptchaState,
} from "@/lib/turnstile/state";
import type { TurnstileApi } from "@/lib/turnstile/types";

/**
 * Renders one Turnstile widget and reports what happens as events. The parent
 * remounts it (React `key`) to get a fresh token, because a token can be used
 * only once. Events from a widget that was already removed are dropped.
 */
function TurnstileWidget({ onEvent }: { onEvent: Dispatch<CaptchaEvent> }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let widgetId: string | null = null;
    const emit = (event: CaptchaEvent) => {
      if (!cancelled) onEvent(event);
    };

    async function start(target: HTMLElement) {
      let api: TurnstileApi;
      try {
        api = await loadTurnstile();
      } catch (err) {
        console.error("[captcha] could not load the script:", err);
        emit({ type: "error", reason: "script" });
        return;
      }
      if (cancelled) return;
      try {
        widgetId = api.render(target, {
          sitekey: turnstileSiteKey(),
          size: "flexible",
          appearance: "interaction-only",
          theme: "auto",
          callback: (token) => emit({ type: "token", token }),
          "expired-callback": () => emit({ type: "expired" }),
          "error-callback": (code) => {
            console.warn(`[captcha] widget error: ${code ?? "unknown"}`);
            emit({ type: "error", reason: "widget" });
          },
        });
      } catch (err) {
        console.error("[captcha] could not render the widget:", err);
        emit({
          type: "error",
          reason:
            err instanceof MissingTurnstileEnvError ? "unconfigured" : "widget",
        });
      }
    }

    void start(container);
    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [onEvent]);

  return <div ref={containerRef} className="w-full" />;
}

/**
 * The CAPTCHA widget (visible only when Turnstile needs the visitor to act), a
 * polite status line for screen readers, and a retry button after a failure.
 * Rendered once by `CaptchaProvider`, which owns the state; forms enable their
 * submit buttons only while `state.status === "verified"`. "Verifying…" appears
 * only if the check runs longer than `CAPTCHA_STATUS_DELAY_MS`.
 */
export function CaptchaField({
  state,
  dispatch,
}: {
  state: CaptchaState;
  dispatch: Dispatch<CaptchaEvent>;
}) {
  // The attempt whose check has run past the delay. Comparing it with the
  // current attempt resets the delay on every new widget without a state
  // update inside the effect.
  const [slowAttempt, setSlowAttempt] = useState<number | null>(null);
  useEffect(() => {
    if (state.status !== "pending") return;
    const attempt = state.attempt;
    const timer = setTimeout(
      () => setSlowAttempt(attempt),
      CAPTCHA_STATUS_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [state.status, state.attempt]);
  const message = visibleCaptchaMessage(state, slowAttempt === state.attempt);
  return (
    <div className="flex flex-col gap-2">
      <TurnstileWidget key={state.attempt} onEvent={dispatch} />
      <div role="status" aria-live="polite">
        {message ? (
          <p
            className={
              state.status === "failed"
                ? "text-sm text-red-600"
                : "text-sm text-gray-600"
            }
          >
            {message}
          </p>
        ) : null}
      </div>
      {captchaCanRetry(state) ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "reset" })}
          className="self-start text-sm underline"
        >
          Try the verification again
        </button>
      ) : null}
    </div>
  );
}

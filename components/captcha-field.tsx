"use client";

import { useEffect, useRef, type Dispatch } from "react";
import {
  MissingTurnstileEnvError,
  turnstileSiteKey,
} from "@/lib/turnstile/env";
import { loadTurnstile } from "@/lib/turnstile/load-script";
import {
  captchaCanRetry,
  captchaStatusMessage,
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
 * The CAPTCHA part of a form: the widget (visible only when Turnstile needs
 * the visitor to act), a polite status line for screen readers, and a retry
 * button after a failure. The owner keeps the state with `captchaReducer` and
 * enables its submit button only while `state.status === "verified"`.
 */
export function CaptchaField({
  state,
  dispatch,
}: {
  state: CaptchaState;
  dispatch: Dispatch<CaptchaEvent>;
}) {
  const message = captchaStatusMessage(state);
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

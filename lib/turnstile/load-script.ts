import type { TurnstileApi } from "./types";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let pending: Promise<TurnstileApi> | null = null;

/**
 * Loads Cloudflare's Turnstile script once per page and resolves with its API.
 * Browser only: call it from an effect. A failed load is not cached, so a
 * retry (the "try again" button) loads the script again.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;

  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const fail = (script: HTMLScriptElement, message: string) => {
      script.remove();
      pending = null;
      reject(new Error(message));
    };
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = window.turnstile;
      if (api) resolve(api);
      else
        fail(
          script,
          "Turnstile script loaded but window.turnstile is missing.",
        );
    };
    script.onerror = () => fail(script, "Turnstile script failed to load.");
    document.head.appendChild(script);
  });
  return pending;
}

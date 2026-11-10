/**
 * The part of Cloudflare's `window.turnstile` API this app uses (explicit
 * rendering). Typed here so no `any` is needed; see
 * developers.cloudflare.com/turnstile/get-started/client-side-rendering.
 */
export interface TurnstileRenderOptions {
  sitekey: string;
  /** Called with the token once the check passes. Tokens are single-use. */
  callback: (token: string) => void;
  /** Called when the widget fails (network, unsupported browser, bad key...). */
  "error-callback"?: (errorCode?: string) => void;
  /** Called when a token expires before use; the widget refreshes itself. */
  "expired-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
  /** `flexible` fills the container width (min 300px), so it suits mobile. */
  size?: "normal" | "flexible" | "compact";
  /** `interaction-only` stays hidden unless the visitor must act. */
  appearance?: "always" | "execute" | "interaction-only";
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

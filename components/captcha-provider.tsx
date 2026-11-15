"use client";

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { preconnect, preload } from "react-dom";
import { CaptchaField } from "@/components/captcha-field";
import { cn } from "@/components/ui/cn";
import {
  TURNSTILE_ORIGIN,
  TURNSTILE_SCRIPT_SRC,
} from "@/lib/turnstile/load-script";
import {
  captchaReducer,
  INITIAL_CAPTCHA_STATE,
  type CaptchaEvent,
  type CaptchaState,
} from "@/lib/turnstile/state";

interface CaptchaContextValue {
  state: CaptchaState;
  dispatch: Dispatch<CaptchaEvent>;
}

const CaptchaContext = createContext<CaptchaContextValue | null>(null);

/**
 * One CAPTCHA check for a whole group of pages. It owns the state and renders
 * the single widget after its children, so the sign-in form and "Try demo"
 * share one token instead of running two checks, and moving between the auth
 * pages does not start a new one. Consumers read it with `useCaptcha`.
 *
 * By default the widget renders after the children (the auth pages). With
 * `slot="manual"` the provider renders no widget and the page places a
 * `<CaptchaSlot />` where it belongs (the landing page puts it right under the
 * hero button, so the header and hero buttons share one check and one widget).
 *
 * The preconnect and preload hints let the browser start fetching Cloudflare's
 * script while the page loads, not after hydration. Both use the exact URL
 * that `loadTurnstile` injects, so the preloaded copy is the one reused.
 */
export function CaptchaProvider({
  children,
  slot = "after",
}: {
  children: ReactNode;
  slot?: "after" | "manual";
}) {
  preconnect(TURNSTILE_ORIGIN);
  preload(TURNSTILE_SCRIPT_SRC, { as: "script" });

  const [state, dispatch] = useReducer(captchaReducer, INITIAL_CAPTCHA_STATE);
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <CaptchaContext.Provider value={value}>
      {children}
      {slot === "after" ? (
        <CaptchaField state={state} dispatch={dispatch} />
      ) : null}
    </CaptchaContext.Provider>
  );
}

/**
 * Where the widget goes with `slot="manual"`. It reserves 64 px (the height of
 * Turnstile's widget, DESIGN 6.1) so a challenge or the "Verifying…" line
 * appears without moving anything. The widget is `interaction-only`, so most
 * visitors never see more than that empty space.
 */
export function CaptchaSlot({ className }: { className?: string }) {
  const { state, dispatch } = useCaptcha();
  return (
    <div className={cn("min-h-16", className)}>
      <CaptchaField state={state} dispatch={dispatch} />
    </div>
  );
}

/**
 * The shared CAPTCHA state. A token is single-use: after any attempt that sent
 * one to Supabase and did not leave the page, dispatch `{ type: "reset" }`.
 */
export function useCaptcha(): CaptchaContextValue {
  const value = useContext(CaptchaContext);
  if (!value) {
    throw new Error("useCaptcha must be used inside <CaptchaProvider>.");
  }
  return value;
}

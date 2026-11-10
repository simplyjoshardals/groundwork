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
 * The preconnect and preload hints let the browser start fetching Cloudflare's
 * script while the page loads, not after hydration. Both use the exact URL
 * that `loadTurnstile` injects, so the preloaded copy is the one reused.
 */
export function CaptchaProvider({ children }: { children: ReactNode }) {
  preconnect(TURNSTILE_ORIGIN);
  preload(TURNSTILE_SCRIPT_SRC, { as: "script" });

  const [state, dispatch] = useReducer(captchaReducer, INITIAL_CAPTCHA_STATE);
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <CaptchaContext.Provider value={value}>
      {children}
      <CaptchaField state={state} dispatch={dispatch} />
    </CaptchaContext.Provider>
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

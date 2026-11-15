"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useCaptcha } from "@/components/captcha-provider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  AUTH_UNAVAILABLE_MESSAGE,
  isAuthUnavailable,
} from "@/lib/auth/auth-unavailable";
import { demoCta, type DemoPlacement } from "@/lib/demo/cta-state";
import { useOnlineStatus } from "@/lib/net/use-online-status";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  CAPTCHA_REJECTED_MESSAGE,
  isCaptchaRejection,
} from "@/lib/turnstile/state";

type DemoStartValue = {
  starting: boolean;
  error: string | null;
  start: () => Promise<void>;
};

const DemoStartContext = createContext<DemoStartValue | null>(null);

const GENERIC_ERROR = "Could not start the demo. Please try again.";

/**
 * One "start a demo session" request shared by every Try demo button on a
 * page, so the landing header and hero buttons cannot fire two requests, and
 * a failure has one place to be shown. Supabase Auth requires a Turnstile
 * token (`options.captchaToken`) and verifies it server-side; a token is
 * single-use, so every failed attempt asks the widget for a new one. Must sit
 * inside `CaptchaProvider`. `next` was validated by the server page.
 */
export function DemoStartProvider({
  next = "/",
  children,
}: {
  next?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { state: captcha, dispatch: dispatchCaptcha } = useCaptcha();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (captcha.status !== "verified" || starting) return;
    setStarting(true);
    setError(null);
    try {
      const { error: signInError } =
        await createBrowserSupabase().auth.signInAnonymously({
          options: { captchaToken: captcha.token },
        });
      if (signInError) {
        console.error(
          "Anonymous sign-in failed:",
          signInError.code ?? signInError.message,
        );
        // Task 5.9: an unreachable auth service (for example a paused
        // project) is not the visitor's mistake and is worth retrying later.
        setError(
          isCaptchaRejection(signInError)
            ? CAPTCHA_REJECTED_MESSAGE
            : isAuthUnavailable(signInError)
              ? AUTH_UNAVAILABLE_MESSAGE
              : GENERIC_ERROR,
        );
        dispatchCaptcha({ type: "reset" });
        return;
      }
      // Refresh so the server components see the new session cookies.
      router.replace(next);
      router.refresh();
    } catch (err) {
      console.error("Anonymous sign-in failed:", err);
      setError(GENERIC_ERROR);
      dispatchCaptcha({ type: "reset" });
    } finally {
      setStarting(false);
    }
  }

  return (
    <DemoStartContext.Provider value={{ starting, error, start }}>
      {children}
    </DemoStartContext.Provider>
  );
}

function useDemoStart(): DemoStartValue {
  const value = useContext(DemoStartContext);
  if (!value) {
    throw new Error("Demo start controls must be inside <DemoStartProvider>.");
  }
  return value;
}

/** The "Try demo" button. Its label and enabled state come from `demoCta`. */
export function DemoStartButton({ placement }: { placement: DemoPlacement }) {
  const { starting, start } = useDemoStart();
  const { state: captcha } = useCaptcha();
  const online = useOnlineStatus();
  const { label, disabled } = demoCta({ captcha, online, starting, placement });
  return (
    <Button
      variant={placement === "auth" ? "secondary" : "primary"}
      size={placement === "hero" ? "lg" : "md"}
      className={cn(
        placement === "hero" && "min-w-[11rem]",
        placement === "auth" && "w-full",
      )}
      disabled={disabled}
      aria-busy={starting || undefined}
      onClick={start}
    >
      {label}
    </Button>
  );
}

/** The failure banner (DESIGN 6.1 X): captcha rejected, auth unavailable, generic. */
export function DemoErrorNotice() {
  const { error } = useDemoStart();
  return error ? <Banner tone="danger">{error}</Banner> : null;
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCaptcha } from "@/components/captcha-provider";
import {
  AUTH_UNAVAILABLE_MESSAGE,
  isAuthUnavailable,
} from "@/lib/auth/auth-unavailable";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  CAPTCHA_REJECTED_MESSAGE,
  isCaptchaRejection,
} from "@/lib/turnstile/state";

/**
 * Starts an anonymous demo session. Supabase Auth requires a Turnstile token
 * (`options.captchaToken`) and verifies it server-side; the button stays
 * disabled until the shared widget (`CaptchaProvider`) has produced one. A
 * token is single-use, so every failed attempt asks the widget for a new one.
 */
export function TryDemoButton({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const { state: captcha, dispatch: dispatchCaptcha } = useCaptcha();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    if (captcha.status !== "verified") return;
    setPending(true);
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
              : "Could not start the demo. Please try again.",
        );
        dispatchCaptcha({ type: "reset" });
        return;
      }
      // `next` was validated by the server page. Refresh so the server
      // components see the new session cookies.
      router.replace(next);
      router.refresh();
    } catch (err) {
      console.error("Anonymous sign-in failed:", err);
      setError("Could not start the demo. Please try again.");
      dispatchCaptcha({ type: "reset" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <button
        type="button"
        onClick={startDemo}
        disabled={pending || captcha.status !== "verified"}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Starting demo…" : "Try demo"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

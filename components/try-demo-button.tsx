"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Starts an anonymous demo session. CAPTCHA (Slice 5) will pass its token as
 * `options.captchaToken` to this same call.
 */
export function TryDemoButton({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setPending(true);
    setError(null);
    try {
      const { error: signInError } =
        await createBrowserSupabase().auth.signInAnonymously();
      if (signInError) {
        console.error("Anonymous sign-in failed:", signInError.message);
        setError("Could not start the demo. Please try again.");
        return;
      }
      // `next` was validated by the server page. Refresh so the server
      // components see the new session cookies.
      router.replace(next);
      router.refresh();
    } catch (err) {
      console.error("Anonymous sign-in failed:", err);
      setError("Could not start the demo. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={startDemo}
        disabled={pending}
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

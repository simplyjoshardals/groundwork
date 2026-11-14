"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const { error: signOutError } =
        await createBrowserSupabase().auth.signOut();
      if (signOutError) {
        console.warn(`[auth] sign-out failed: ${signOutError.name}`);
        setError("Could not sign out. Please try again.");
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch (err) {
      console.error("[auth] sign-out failed:", err);
      setError("Could not sign out. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="rounded-md border border-control px-3 py-1 text-sm disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

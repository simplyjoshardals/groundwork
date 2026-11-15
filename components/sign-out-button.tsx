"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * The label never changes while signing out (the button just disables), so its
 * width, and the header around it, stays put. The error floats under the button
 * (absolutely positioned) so it cannot push the layout either. `ghost` in the
 * header, where `-mr-3` lines its text up with the page edge; `secondary` in
 * the Account section.
 */
export function SignOutButton({
  variant = "ghost",
  className,
}: {
  variant?: "ghost" | "secondary";
  className?: string;
}) {
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
      router.replace("/");
      router.refresh();
    } catch (err) {
      console.error("[auth] sign-out failed:", err);
      setError("Could not sign out. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative">
      <Button
        variant={variant}
        size="sm"
        onClick={signOut}
        disabled={pending}
        aria-busy={pending}
        className={className}
      >
        Sign out
      </Button>
      {error ? (
        <p
          role="alert"
          className="absolute top-full right-0 z-40 mt-1 rounded-md border border-danger/60 bg-danger-soft px-2 py-1 text-xs whitespace-nowrap text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
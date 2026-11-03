import { AskPanel } from "@/components/ask-panel";
import { TryDemoButton } from "@/components/try-demo-button";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Home: signed out, the intro and "Try demo"; with a session (demo or
 * regular), the ask UI. `/api/ask` re-checks the session on every request.
 */
export default async function Home() {
  const supabase = await createServerSupabase();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    console.warn(`[home] session check failed: ${claimsError.name}`);
  }
  const signedIn = Boolean(data?.claims);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Groundwork</h1>
      <p>Ask questions about documents and see where each answer comes from.</p>
      {signedIn ? <AskPanel /> : <TryDemoButton />}
    </main>
  );
}

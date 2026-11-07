import { Suspense } from "react";
import { TryDemoButton } from "@/components/try-demo-button";
import { Workspace } from "@/components/workspace";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Home: signed out, the intro and "Try demo"; with a session (demo or
 * regular), the ask UI and, when the URL names a document, the viewer.
 * `/api/ask` re-checks the session on every request.
 */
export default async function Home() {
  const supabase = await createServerSupabase();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    console.warn(`[home] session check failed: ${claimsError.name}`);
  }
  const signedIn = Boolean(data?.claims);

  const intro = (
    <>
      <h1 className="text-2xl font-semibold">Groundwork</h1>
      <p>Ask questions about documents and see where each answer comes from.</p>
    </>
  );
  const introColumn = "mx-auto flex w-full max-w-2xl flex-col gap-6";

  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      {signedIn ? (
        // `useSearchParams` (in Workspace) needs a Suspense boundary.
        <Suspense fallback={<div className={introColumn}>{intro}</div>}>
          <Workspace>{intro}</Workspace>
        </Suspense>
      ) : (
        <div className={introColumn}>
          {intro}
          <TryDemoButton />
        </div>
      )}
    </main>
  );
}

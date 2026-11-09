import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { DocumentsPanel } from "@/components/documents-panel";
import { Workspace } from "@/components/workspace";
import { getSessionState } from "@/lib/auth/session";

/**
 * The app. Signed out, it redirects to the sign-in page; with a session (demo
 * or regular), it shows the ask UI and, when the URL names a document, the
 * viewer. This guard is a UI convenience: `/api/ask` re-checks the session on
 * every request and RLS decides what data is visible.
 */
export default async function Home() {
  const session = await getSessionState();
  if (session.status === "signed_out") redirect("/sign-in");

  const intro = (
    <>
      <h1 className="text-2xl font-semibold">Groundwork</h1>
      <p>Ask questions about documents and see where each answer comes from.</p>
    </>
  );
  const introColumn = "mx-auto flex w-full max-w-2xl flex-col gap-6";

  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <div className="mb-6 flex flex-wrap items-center justify-end gap-3 text-sm">
        <span>
          {session.isAnonymous
            ? "Demo session"
            : (session.email ?? "Signed in")}
        </span>
        {session.isAnonymous ? (
          <Link href="/sign-up" className="underline">
            Create an account
          </Link>
        ) : null}
        <SignOutButton />
      </div>
      {/* `useSearchParams` (in Workspace) needs a Suspense boundary. */}
      <Suspense fallback={<div className={introColumn}>{intro}</div>}>
        <Workspace>
          {intro}
          <DocumentsPanel canUpload={!session.isAnonymous} />
        </Workspace>
      </Suspense>
    </main>
  );
}

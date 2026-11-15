import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { DocumentsPanel } from "@/components/documents-panel";
import { LandingPage } from "@/components/landing/landing-page";
import { WaitingPage } from "@/components/waiting-page";
import { Workspace } from "@/components/workspace";
import { nextFromSearchParams } from "@/lib/auth/shared-link";
import { getSessionCheck } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The app. Signed out, it shows the landing page (U1; a shared `?doc=` link is
 * carried through Try demo and Sign in). With a session (demo or regular), it
 * shows the ask UI and, when the URL names a document, the viewer. This guard
 * is a UI convenience: `/api/ask` re-checks the session on every request and
 * RLS decides what data is visible. If the auth service cannot be reached (for
 * example a paused project) it shows the waiting page instead of sending a
 * signed-in user to the landing page (Task 5.9).
 */
export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSessionCheck();
  if (session.status === "signed_out") {
    return <LandingPage next={nextFromSearchParams(await searchParams)} />;
  }
  if (session.status === "unavailable") return <WaitingPage />;

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

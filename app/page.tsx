import { Suspense } from "react";
import { AccountSection } from "@/components/account-section";
import { AppHeader } from "@/components/app-header";
import { DocumentsPanel } from "@/components/documents-panel";
import { LandingPage } from "@/components/landing/landing-page";
import { OfflineBanner } from "@/components/offline-banner";
import { SampleShelf } from "@/components/sample-shelf";
import { ToastProvider } from "@/components/ui/toast";
import { UsageProvider } from "@/components/usage-context";
import { WaitingPage } from "@/components/waiting-page";
import { Workspace } from "@/components/workspace";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { peekUsage } from "@/features/limits/peek-usage";
import { nextFromSearchParams } from "@/lib/auth/shared-link";
import { getSessionCheck } from "@/lib/auth/session";
import { toInitialDocuments } from "@/lib/documents/initial-documents";
import {
  listOwnDocuments,
  listSampleDocuments,
} from "@/lib/documents/list-own-documents";
import { createServerSupabase } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The app. Signed out, it shows the landing page (U1; a shared `?doc=` link is
 * carried through Try demo and Sign in). With a session (demo or regular), it
 * shows the header, the ask UI, the shelf and, when the URL names a document,
 * the viewer. This guard is a UI convenience: `/api/ask` re-checks the session
 * on every request and RLS decides what data is visible. If the auth service
 * cannot be reached (for example a paused project) it shows the waiting page
 * instead of sending a signed-in user to the landing page (Task 5.9).
 *
 * The first documents read and the question budget happen here, on the server,
 * so the shelf and the counter have data on first paint. The read uses the
 * caller's RLS-scoped client, never the admin client.
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

  const supabase = await createServerSupabase();
  const [documents, usage] = await Promise.all([
    session.isAnonymous
      ? listSampleDocuments(supabase)
      : listOwnDocuments(supabase),
    peekUsage(session.userId),
  ]);
  const initial = toInitialDocuments(documents);
  const hasOwnDocuments =
    !session.isAnonymous && documents.ok && documents.documents.length > 0;

  const shelf = session.isAnonymous ? (
    <SampleShelf documents={documents.ok ? documents.documents : null} />
  ) : (
    <DocumentsPanel initial={initial} />
  );

  return (
    <UsageProvider initial={usage}>
      <ToastProvider>
        <AppHeader isAnonymous={session.isAnonymous} email={session.email} />
        <main className="mx-auto w-full max-w-[84rem] flex-1 px-4 pt-6 pb-12 md:px-6 md:pt-8 xl:px-8">
          <h1 className="sr-only">Groundwork</h1>
          <div className="mb-6 empty:hidden">
            <OfflineBanner>
              You’re offline. Questions and uploads will work again when you’re
              back.
            </OfflineBanner>
          </div>
          {/* `useSearchParams` (in Workspace) needs a Suspense boundary. */}
          <Suspense fallback={<WorkspaceSkeleton />}>
            <Workspace
              showExamples={session.isAnonymous || !hasOwnDocuments}
              shelf={shelf}
              account={
                <AccountSection
                  isAnonymous={session.isAnonymous}
                  email={session.email}
                />
              }
            />
          </Suspense>
        </main>
      </ToastProvider>
    </UsageProvider>
  );
}

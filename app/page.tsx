import { TryDemoButton } from "@/components/try-demo-button";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Task 1.7 placeholder home: shows whether a session exists and which
 * documents RLS lets it see. Task 1.10 replaces this with the ask UI.
 */
export default async function Home() {
  const supabase = await createServerSupabase();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    console.warn(`[home] session check failed: ${claimsError.name}`);
  }
  const claims = data?.claims ?? null;

  if (!claims) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Groundwork</h1>
        <p>
          Ask questions about documents and see where each answer comes from.
        </p>
        <TryDemoButton />
      </main>
    );
  }

  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("id, title, page_count, status")
    .order("title");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Groundwork</h1>
      <p>Session active. Anonymous: {claims.is_anonymous ? "yes" : "no"}.</p>
      {documentsError ? (
        <p role="alert" className="text-red-600">
          Could not load documents.
        </p>
      ) : (
        <section>
          <h2 className="font-medium">
            Documents visible to this session ({documents?.length ?? 0})
          </h2>
          <ul className="list-disc pl-6">
            {(documents ?? []).map((doc) => (
              <li key={doc.id}>
                {doc.title} ({doc.page_count ?? "?"} pages, {doc.status})
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

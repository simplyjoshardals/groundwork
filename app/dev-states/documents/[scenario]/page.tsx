import { notFound } from "next/navigation";
import { DocumentsDrill } from "@/components/dev/documents-drill";
import {
  DOC_SCENARIO_NOTES,
  drillNowMs,
  isDocScenario,
} from "@/lib/documents/dev-scenario-names";

// Dev only: the documents shelf against scripted data (U5). 404s elsewhere.
export const dynamic = "force-dynamic";

export default async function DocumentsDrillPage({
  params,
}: {
  params: Promise<{ scenario: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { scenario } = await params;
  if (!isDocScenario(scenario)) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-6">
      <p className="text-sm text-muted text-pretty">
        <span className="font-mono">{scenario}</span>: {DOC_SCENARIO_NOTES[scenario]}
      </p>
      <DocumentsDrill scenario={scenario} now={drillNowMs()} />
    </main>
  );
}

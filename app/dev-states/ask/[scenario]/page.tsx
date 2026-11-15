import Link from "next/link";
import { notFound } from "next/navigation";
import { AskDrill } from "../drill";
import { SCENARIOS, isScenario } from "../scenarios";

/**
 * Dev drill for the ask experience: `/dev-states/ask/<scenario>` runs the real
 * ask panel against a scripted stream; `/dev-states/ask/index` lists them.
 * Add `?chips=1` to show the example chips. A 404 outside `next dev`, so it
 * never ships.
 */
export default async function AskDrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ scenario: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { scenario } = await params;
  const { chips } = await searchParams;

  if (scenario === "index") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-4 font-serif text-h2">Ask drill</h1>
        <ul className="flex flex-col gap-2 text-sm">
          {Object.entries(SCENARIOS).map(([name, { title }]) => (
            <li key={name}>
              <Link className="underline underline-offset-4" href={`/dev-states/ask/${name}`}>
                {name}
              </Link>{" "}
              <span className="text-muted">{title}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          Add <code className="font-mono">?chips=1</code> to show the example
          chips.
        </p>
      </main>
    );
  }
  if (!isScenario(scenario)) notFound();
  return <AskDrill scenario={scenario} showExamples={chips === "1"} />;
}

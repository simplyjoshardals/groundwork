import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewerDrill } from "../drill";
import { SCENARIOS, isScenario } from "../scenarios";

/**
 * Dev drill for the viewer: `/dev-states/viewer/<scenario>` runs the real
 * viewer against scripted data; `/dev-states/viewer/index` lists the scenarios.
 * Offline needs no scenario: open one, then switch the browser to Offline in
 * DevTools and press Retry. A 404 outside `next dev`, so it never ships.
 */
export default async function ViewerDrillPage({
  params,
}: {
  params: Promise<{ scenario: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { scenario } = await params;

  if (scenario === "index") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-4 font-serif text-h2">Viewer drill</h1>
        <ul className="flex flex-col gap-2 text-sm">
          {Object.entries(SCENARIOS).map(([name, { title }]) => (
            <li key={name}>
              <Link
                className="underline underline-offset-4"
                href={`/dev-states/viewer/${name}`}
              >
                {name}
              </Link>{" "}
              <span className="text-muted">{title}</span>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  if (!isScenario(scenario)) notFound();
  return <ViewerDrill scenario={scenario} />;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DOC_SCENARIOS,
  DOC_SCENARIO_NOTES,
} from "@/lib/documents/dev-scenario-names";

// Dev only: lists the documents drill scenarios (U5). 404s elsewhere.
export default function DocumentsDrillIndex() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 md:px-6">
      <h1 className="font-serif text-h2">Documents drill</h1>
      <ul className="flex flex-col gap-3 text-sm">
        {DOC_SCENARIOS.map((name) => (
          <li key={name}>
            <Link
              href={`/dev-states/documents/${name}`}
              className="font-mono text-accent underline underline-offset-4"
            >
              {name}
            </Link>
            <span className="text-muted"> {DOC_SCENARIO_NOTES[name]}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

import type { StreamSource } from "@/types/ask-stream";

/** Passages the answer was drawn from: marker, document, page, snippet. */
export function SourceList({ sources }: { sources: readonly StreamSource[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No matching passages were found in the documents.
      </p>
    );
  }

  return (
    <section aria-label="Sources" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Sources</h3>
      <ol className="flex flex-col gap-3">
        {sources.map((source) => (
          <li
            key={source.marker}
            className="rounded-md border border-neutral-200 p-3 text-sm"
          >
            <p className="font-medium">
              <span className="text-neutral-500">[{source.marker}]</span>{" "}
              {source.documentTitle}, p. {source.page}
            </p>
            <p className="mt-1 text-neutral-600">{source.snippet}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

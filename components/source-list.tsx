import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { StreamSource } from "@/types/ask-stream";

/**
 * Passages the answer was drawn from, as footnote-style cards (DESIGN 5.5): a
 * mono numeral (the same one as the marker in the answer), the document
 * title, `p. N`, a two-line snippet and an "Open page N" button. The card for
 * the highlighted marker gets a ring; hovering or focusing a card lights its
 * marker in turn.
 */
export function SourceList({
  sources,
  label = "Sources",
  showHeading = true,
  activeMarker = null,
  openChunkId = null,
  onHighlight,
  onOpenSource,
}: {
  sources: readonly StreamSource[];
  /** Accessible name of the list; also the heading text when it is shown. */
  label?: string;
  /** False when a parent already provides a heading (e.g. a `<summary>`). */
  showHeading?: boolean;
  activeMarker?: number | null;
  /** Chunk id of the source open in the viewer, if any. */
  openChunkId?: string | null;
  onHighlight?: (marker: number | null) => void;
  onOpenSource: (source: StreamSource, trigger: HTMLElement) => void;
}) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted">
        No matching passages were found in your documents.
      </p>
    );
  }

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      {showHeading ? <h3 className="font-sans text-xs font-medium text-muted">{label}</h3> : null}
      <ol className="flex flex-col gap-3">
        {sources.map((source) => (
          <li
            key={source.marker}
            aria-current={activeMarker === source.marker ? "true" : undefined}
            onMouseEnter={() => onHighlight?.(source.marker)}
            onMouseLeave={() => onHighlight?.(null)}
            onFocus={() => onHighlight?.(source.marker)}
            onBlur={() => onHighlight?.(null)}
            className={cn(
              "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border bg-surface px-4 pt-4 pb-2 transition-colors duration-(--dur-fast)",
              openChunkId === String(source.chunkId)
                ? "border-accent/60"
                : "border-line",
              activeMarker === source.marker &&
                "bg-accent-soft ring-2 ring-accent/40",
            )}
          >
            <span className="pt-0.5 font-mono text-xs text-muted tabular-nums">
              {source.marker}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm font-medium break-words">
                  {source.documentTitle}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                  p. {source.page}
                </span>
              </p>
              <p className="line-clamp-2 font-serif text-sm text-muted">
                {source.snippet}
              </p>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3"
                  data-citation-chunk={source.chunkId}
                  onClick={(event) =>
                    onOpenSource(source, event.currentTarget)
                  }
                >
                  Open page {source.page}
                  <span className="sr-only">
                    {" "}
                    of {source.documentTitle}, source {source.marker}
                  </span>
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
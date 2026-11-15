import { cn } from "@/components/ui/cn";
import { splitParagraphs } from "@/lib/ask/paragraphs";
import type { StreamSource } from "@/types/ask-stream";

/**
 * The answer, one `<p>` per paragraph, with `[n]` markers drawn as citation
 * markers (DESIGN 5.5). Markers that match no retrieved source are removed
 * before drawing. A marker shows only its digit; its accessible name is the
 * full "Source n: title, page p". Hovering or focusing one tells the parent
 * (`onHighlight`, which lights the matching card and warms the viewer
 * lookups); clicking opens the source in the viewer. The marker whose source
 * is open in the viewer is solid.
 */
export function AnswerText({
  text,
  sources,
  streaming,
  activeMarker,
  openChunkId,
  onHighlight,
  onPrefetch,
  onOpenSource,
}: {
  text: string;
  /** `null` while the `sources` event has not arrived: every marker is hidden. */
  sources: readonly StreamSource[] | null;
  streaming: boolean;
  /** The marker currently highlighted from either side (marker or card). */
  activeMarker: number | null;
  /** Chunk id of the source open in the viewer, if any. */
  openChunkId: string | null;
  onHighlight: (marker: number | null) => void;
  onPrefetch: (source: StreamSource) => void;
  /** Called with the clicked source and the marker, so focus can return to it. */
  onOpenSource: (source: StreamSource, trigger: HTMLElement) => void;
}) {
  const list = sources ?? [];
  const paragraphs = splitParagraphs(text, list.length, { streaming });

  return (
    <div className="flex max-w-[36rem] flex-col gap-4 font-serif text-read text-ink">
      {paragraphs.map((segments, paragraphIndex) => (
        <p key={paragraphIndex} className="text-pretty">
          {segments.map((segment, index) => {
            if (segment.type === "text") return segment.text;

            const source = list.find((item) => item.marker === segment.marker);
            // `splitParagraphs` only returns markers within 1..list.length, but
            // markers are matched by value, so a gap would drop one, not crash.
            if (!source) return null;
            const label = `Source ${source.marker}: ${source.documentTitle}, page ${source.page}`;
            const solid =
              activeMarker === source.marker ||
              openChunkId === String(source.chunkId);

            return (
              <button
                key={index}
                type="button"
                title={label}
                aria-current={solid ? "true" : undefined}
                onClick={(event) => onOpenSource(source, event.currentTarget)}
                onMouseEnter={() => {
                  onHighlight(source.marker);
                  onPrefetch(source);
                }}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => {
                  onHighlight(source.marker);
                  onPrefetch(source);
                }}
                onBlur={() => onHighlight(null)}
                className={cn(
                  "relative -top-[0.3em] mx-0.5 inline-block rounded-sm px-1 align-baseline font-mono text-[0.7em] font-medium transition-colors duration-(--dur-fast) after:absolute after:-inset-1.5",
                  solid
                    ? "bg-accent text-accent-fg"
                    : "bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg",
                )}
              >
                <span aria-hidden="true">{source.marker}</span>
                <span className="sr-only">{label}</span>
              </button>
            );
          })}
        </p>
      ))}
    </div>
  );
}

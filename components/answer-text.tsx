import { segmentAnswer } from "@/lib/ask/citations";
import type { StreamSource } from "@/types/ask-stream";

/**
 * The answer text with `[n]` markers drawn as citation chips. Markers that do
 * not match a retrieved source are removed before drawing, so an invalid one
 * never reaches the screen. The chip shows only `[n]` to keep adjacent
 * citations compact; the full label is its accessible name and tooltip, and
 * the source list below shows it in full. Chips are not interactive yet
 * (opening the viewer is Task 3.3).
 */
export function AnswerText({
  text,
  sources,
  streaming,
}: {
  text: string;
  /** `null` while the `sources` event has not arrived: every marker is hidden. */
  sources: readonly StreamSource[] | null;
  streaming: boolean;
}) {
  const list = sources ?? [];
  const segments = segmentAnswer(text, list.length, { streaming });

  return (
    <p className="whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (segment.type === "text") return segment.text;

        const source = list.find((item) => item.marker === segment.marker);
        // `segmentAnswer` only returns markers within 1..list.length, but
        // markers are matched by value, so a gap would drop the chip, not crash.
        if (!source) return null;
        const label = `Source ${source.marker}: ${source.documentTitle}, page ${source.page}`;

        return (
          <span
            key={index}
            title={label}
            className="mx-0.5 inline-block rounded bg-neutral-100 px-1 align-baseline text-xs font-medium text-neutral-700"
          >
            <span aria-hidden="true">[{source.marker}]</span>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </p>
  );
}

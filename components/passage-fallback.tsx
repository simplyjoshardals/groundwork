import { useId } from "react";
import type { FallbackPassage } from "@/lib/pdf-highlight/fallback";

/**
 * The cited passage shown as text, for when it could not be pinpointed on the
 * page (Task 3.6), styled as a margin note (DESIGN 6.6): sunken, with the
 * highlighter-colored rule that belongs to the cited passage and nothing else.
 * Labelled as a fallback so it is never mistaken for the highlight itself.
 *
 * The text comes from a document, so it is rendered as plain React text
 * (escaped), never as HTML. It stays selectable. The scrollable box is
 * focusable so keyboard users can scroll a long passage.
 */
export function PassageFallback({ passage }: { passage: FallbackPassage }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-r-md border-l-2 border-highlight bg-sunken py-3 pr-3 pl-4"
    >
      <h3
        id={headingId}
        className="font-mono text-xs font-medium text-muted"
      >
        Cited passage, page {passage.pageNumber}
      </h3>
      <blockquote
        tabIndex={0}
        className="max-h-40 overflow-auto rounded-sm font-serif text-base leading-relaxed break-words whitespace-pre-wrap text-ink focus-visible:-outline-offset-2"
      >
        {passage.text}
      </blockquote>
      <p className="text-xs text-muted">
        Shown as text because it couldn’t be pinpointed on the page.
      </p>
    </section>
  );
}

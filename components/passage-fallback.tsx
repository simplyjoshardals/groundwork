import { useId } from "react";
import type { FallbackPassage } from "@/lib/pdf-highlight/fallback";

/**
 * The cited passage shown as text, for when it could not be highlighted on the
 * page (Task 3.6). Labelled as a fallback so it is never mistaken for the
 * highlight itself.
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
      className="flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        Cited passage, page {passage.pageNumber}
      </h3>
      <p className="text-xs text-neutral-600">
        Shown as text because it could not be pinpointed on the page.
      </p>
      <blockquote
        tabIndex={0}
        className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-sm border-l-2 border-neutral-300 pl-3 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        {passage.text}
      </blockquote>
    </section>
  );
}

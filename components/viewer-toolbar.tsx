import { Button } from "@/components/ui/button";

/**
 * Previous / "Page 7 of 12" / Next (DESIGN 6.6). Sticky at the top of the
 * viewer's scroll region, so it stays reachable while a long page scrolls;
 * `data-viewer-toolbar` tells the scroll helper how much of the region it covers.
 * Controls are 44 px on coarse pointers (the shared Button does that). The label
 * is mono and fixed-width-ish so turning pages never shifts the buttons.
 */
export function ViewerToolbar({
  page,
  total,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
}: {
  page: number;
  /** `null` until the page count is known. */
  total: number | null;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div
      data-viewer-toolbar
      className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2"
    >
      <Button
        variant="secondary"
        size="sm"
        aria-label="Previous page"
        disabled={previousDisabled}
        onClick={onPrevious}
      >
        Previous
      </Button>
      <p
        aria-live="polite"
        className="min-w-[7ch] text-center font-mono text-sm tabular-nums text-ink"
      >
        {total === null ? `Page ${page}` : `Page ${page} of ${total}`}
      </p>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Next page"
        disabled={nextDisabled}
        onClick={onNext}
      >
        Next
      </Button>
    </div>
  );
}

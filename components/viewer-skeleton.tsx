import { Skeleton } from "@/components/ui/skeleton";

// Heading bar first, then two paragraphs of text bars: 8 in all (DESIGN 5.9).
const BARS = [
  "h-3.5 w-2/5",
  "w-full",
  "w-[94%]",
  "w-full",
  "w-[62%]",
  "mt-3 w-full",
  "w-[91%]",
  "w-[48%]",
] as const;

/**
 * The paper-page skeleton: what the viewer shows while the document, the file
 * or the page loads. It sits inside a `PaperSheet`, at the page's usual 8.5 : 11
 * shape so the real page replaces it with little movement. Visual only
 * (`aria-hidden`); whoever shows it says "loading" to screen readers.
 */
export function ViewerSkeleton({ width }: { width?: number }) {
  return (
    <div
      aria-hidden="true"
      className="paper-skeleton aspect-[8.5/11] w-full max-w-full"
      style={width === undefined ? undefined : { width }}
    >
      <div className="flex flex-col gap-2.5 p-[8%]">
        {BARS.map((bar, index) => (
          <Skeleton
            key={index}
            className={bar.startsWith("h-") ? bar : `h-2.5 ${bar}`}
          />
        ))}
      </div>
    </div>
  );
}

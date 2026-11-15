import { SourceList } from "@/components/source-list";
import type { StreamSource } from "@/types/ask-stream";

/**
 * The refusal (DESIGN 6.4 P-b). Not finding an answer is a normal outcome, not
 * a failure, so this is a neutral card: no red, no Retry, `role="status"`.
 * Errors and warnings are banners in `ask-panel.tsx`. The closest passages sit
 * in a collapsed `<details>` so they are there to read without implying that
 * they answer the question.
 */
export function NotFoundNotice({
  message,
  closest,
  onOpenSource,
}: {
  message: string;
  closest: readonly StreamSource[];
  onOpenSource: (source: StreamSource, trigger: HTMLElement) => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-4"
    >
      <p className="font-serif text-read text-ink">{message}</p>
      <p className="text-sm text-muted">
        Try rephrasing, or ask about something the documents cover.
      </p>
      {closest.length > 0 ? (
        <details className="group">
          <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-ink pointer-coarse:py-2">
            Closest passages ({closest.length})
          </summary>
          <div className="mt-3">
            <SourceList
              sources={closest}
              label="Closest passages"
              showHeading={false}
              onOpenSource={onOpenSource}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

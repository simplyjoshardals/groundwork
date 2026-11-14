import { SourceList } from "@/components/source-list";
import type { StreamSource } from "@/types/ask-stream";

/**
 * "Couldn't find that" state. A refusal is a normal outcome, not a failure, so
 * it is neutral (no red, no Retry, `role="status"`); errors keep the red
 * `role="alert"` block with Retry in `ask-panel.tsx`. The closest passages sit
 * in a collapsed `<details>` so they are available without implying an answer.
 */
export function NotFoundNotice({
  message,
  closest,
}: {
  message: string;
  closest: readonly StreamSource[];
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-line bg-sunken p-4 text-sm"
    >
      <p className="font-medium">{message}</p>
      <p className="text-muted">
        Try rephrasing, or ask about something the documents cover.
      </p>
      {closest.length > 0 ? (
        <details>
          <summary className="cursor-pointer font-medium text-ink">
            Closest passages ({closest.length})
          </summary>
          <div className="mt-3">
            <SourceList
              sources={closest}
              label="Closest passages"
              showHeading={false}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

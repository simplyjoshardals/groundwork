import { EXAMPLE_QUESTIONS } from "@/lib/ask-client/examples";

/**
 * Example question chips (DESIGN 6.4, idle state). A click asks at once, so
 * the first answer is one tap away. The last chip is the refusal demo and is
 * set apart with a dashed edge as well as its label.
 */
export function ExampleQuestions({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <section aria-label="Example questions" className="flex flex-col gap-2">
      <h2 className="font-sans text-xs font-medium text-muted">Try asking</h2>
      <ul className="flex flex-wrap gap-2">
        {EXAMPLE_QUESTIONS.map((example) => (
          <li key={example.question}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(example.question)}
              title={example.question}
              className={`rounded-full border bg-surface px-3 py-1.5 text-sm text-ink transition-colors duration-(--dur-fast) enabled:hover:bg-sunken disabled:cursor-not-allowed disabled:text-muted pointer-coarse:min-h-11 ${
                example.unanswerable
                  ? "border-dashed border-control"
                  : "border-control"
              }`}
            >
              {example.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

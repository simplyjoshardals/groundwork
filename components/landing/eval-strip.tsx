export type EvalMetric = { label: string; value: string };

/**
 * The eval-numbers strip (DESIGN 6.1). It renders nothing until Task 6.5
 * produces real numbers: never invent them, and an empty strip on a public
 * page looks worse than none. The landing page passes `null` today; 6.5
 * passes the measured metrics.
 */
export function EvalStrip({
  metrics,
}: {
  metrics: readonly EvalMetric[] | null;
}) {
  if (!metrics || metrics.length === 0) return null;
  return (
    <section
      aria-labelledby="eval-heading"
      className="flex flex-col gap-4 border-y border-line py-6"
    >
      <h2 id="eval-heading" className="text-h3 font-semibold">
        Measured, not claimed.
      </h2>
      <dl className="grid gap-6 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{metric.label}</dt>
            <dd className="font-mono text-h3 tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

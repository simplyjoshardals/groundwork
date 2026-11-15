const GUARANTEES = [
  {
    title: "Cited",
    body: "Every claim in an answer carries a numbered footnote. Open it and the page appears with the passage highlighted.",
  },
  {
    title: "Honest refusals",
    body: "If the answer isn’t in your documents, it says so instead of guessing, and shows the closest passages it found.",
  },
  {
    title: "Private by design",
    body: "Documents you upload are visible only to your account. Demo sessions use the sample documents and never see yours.",
  },
] as const;

/** Three guarantees as a plain list with hairline rules (DESIGN 11: no icon-card template). */
export function Guarantees() {
  return (
    <section
      aria-labelledby="guarantees-heading"
      className="flex flex-col gap-8"
    >
      <h2
        id="guarantees-heading"
        className="max-w-[38rem] text-h2 font-semibold"
      >
        Built so you can check it.
      </h2>
      <ul className="grid gap-8 md:grid-cols-3 md:gap-12">
        {GUARANTEES.map((item) => (
          <li
            key={item.title}
            className="flex flex-col gap-2 border-t border-line pt-4"
          >
            <h3 className="text-h3 font-semibold">{item.title}</h3>
            <p className="text-base text-muted">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

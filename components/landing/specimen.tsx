/**
 * The static specimen (DESIGN 6.1): a short answer with footnote markers
 * beside the page it cites, the cited passage highlighted. Plain HTML and CSS:
 * no image, no JS. The page stays paper-colored in dark mode and sits on the
 * `sunken` desk (DESIGN 3).
 *
 * CONTENT: the page text is copied word for word from page 3 of the sample
 * handbook (two of its paragraphs, with an ellipsis where others sit between
 * them). The highlight is the exact F08 quote from `eval/dataset/facts.md`.
 * The answer paraphrases F08, F11 and F12. Visitors can ask this exact
 * question in the demo. If the handbook text changes, update this to match.
 */
function Marker({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative -top-[0.3em] ml-0.5 inline-block rounded-sm bg-accent-soft px-1 font-mono text-[0.7em] font-medium leading-none text-accent"
    >
      {n}
    </span>
  );
}

/** Keeps a hyphenated word on one line, so "Part-" never ends a line. */
function Word({ children }: { children: string }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

/**
 * A last word with its footnote marker, kept together so a marker never starts
 * a line on its own.
 */
function Cite({ text, n }: { text: string; n: number }) {
  return (
    <span className="whitespace-nowrap">
      {text}
      <Marker n={n} />
    </span>
  );
}

export function Specimen() {
  return (
    <figure aria-labelledby="specimen-caption" className="flex flex-col gap-3">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:p-6">
          <p className="font-serif text-base text-muted">
            How much annual leave do I get, and can I carry any over?
          </p>
          <p className="font-serif text-read text-ink">
            <Word>Full-time</Word> employees get 26 days of paid annual leave in
            each leave <Cite text="year." n={1} /> Up to 5 unused days can be
            carried over, and they must be used by{" "}
            <Cite text="30 June." n={2} />
          </p>
          <p className="border-t border-line pt-3 font-mono text-xs text-muted">
            <span className="mr-2">1, 2</span>Employee handbook, p. 3
          </p>
        </div>
        <div className="rounded-lg bg-sunken p-3 sm:p-6">
          <div className="flex flex-col gap-3 rounded-sm border border-line bg-paper p-4 text-paper-ink shadow-card sm:p-6 dark:brightness-[0.94]">
            <p className="font-mono text-xs">Employee handbook, p. 3</p>
            <p className="font-serif text-sm font-semibold">3. Annual leave</p>
            <p className="font-serif text-sm leading-6">
              <Word>Full-time</Word> employees receive{" "}
              <mark data-hl>26 days of paid annual leave</mark> in each leave
              year. The leave year runs from 1 April to 31 March.{" "}
              <Word>Part-time</Word> employees receive a <Word>pro-rata</Word>{" "}
              entitlement.
            </p>
            <p aria-hidden="true" className="text-center font-serif text-sm">
              …
            </p>
            <p className="font-serif text-sm leading-6">
              Up to 5 days of unused leave can be carried over into the next
              leave year. <Word>Carried-over</Word> days must be used by 30
              June, after which they are lost.
            </p>
          </div>
        </div>
      </div>
      <figcaption id="specimen-caption" className="text-xs text-muted">
        An answer, and the page its first footnote opens.
      </figcaption>
    </figure>
  );
}

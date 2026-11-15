import Link from "next/link";
import { cn } from "@/components/ui/cn";

/**
 * The wordmark (DESIGN 2): "Groundwork" in the serif, 600, 20 px. `rule` adds
 * the 3 px accent rule under the whole word and is for the landing header
 * only. The rule is absolutely positioned, so it adds no height and the word
 * stays on the same centre line as the header buttons. `plain` renders a real
 * `<a>` instead of `next/link`, for `global-error`, where the router may be the
 * thing that broke.
 */
export function Wordmark({
  rule = false,
  plain = false,
  className,
}: {
  rule?: boolean;
  plain?: boolean;
  className?: string;
}) {
  const classes = cn(
    "inline-block font-serif text-xl font-semibold tracking-[-0.01em] text-ink pointer-coarse:py-2",
    className,
  );
  const word = (
    <span
      className={cn(
        "relative",
        rule &&
          "after:absolute after:inset-x-0 after:-bottom-1 after:h-[3px] after:bg-accent",
      )}
    >
      Groundwork
    </span>
  );
  return plain ? (
    // A real anchor on purpose (see `ErrorState`): a full page load is the way
    // back from a crash.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/" className={classes}>
      {word}
    </a>
  ) : (
    <Link href="/" className={classes}>
      {word}
    </Link>
  );
}
import Link from "next/link";
import { cn } from "@/components/ui/cn";

/**
 * The wordmark (DESIGN 2): "Groundwork" in the serif, 600, 20 px. `rule` adds
 * the 3 px accent rule under the whole word and is for the landing header
 * only. `plain` renders a real `<a>` instead of `next/link`, for
 * `global-error`, where the router may be the thing that broke.
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
    rule && "after:mt-1 after:block after:h-[3px] after:bg-accent",
    className,
  );
  return plain ? (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/" className={classes}>
      Groundwork
    </a>
  ) : (
    <Link href="/" className={classes}>
      Groundwork
    </Link>
  );
}
import { Wordmark } from "@/components/wordmark";

/** The bare header for pages with no navigation: wordmark only, 56 px tall. */
export function PlainHeader({ plain = false }: { plain?: boolean }) {
  return (
    <header className="flex h-14 shrink-0 items-center px-4 md:px-6 xl:px-8">
      <Wordmark plain={plain} />
    </header>
  );
}

import { Wordmark } from "@/components/wordmark";

/**
 * The bare header for pages with no navigation: wordmark only, 56 px tall, in
 * the same container as the landing header so the wordmark does not move
 * between pages.
 */
export function PlainHeader({ plain = false }: { plain?: boolean }) {
  return (
    <header className="mx-auto flex h-14 w-full max-w-[68rem] shrink-0 items-center px-4 md:px-6 xl:px-8">
      <Wordmark plain={plain} />
    </header>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback shaped like the workspace (DESIGN 6.3): the intro, the
 * composer and the shelf's first rows, in the same grid, so the page does not
 * jump when the real thing replaces it.
 */
export function WorkspaceSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto grid w-full max-w-2xl items-start gap-8 xl:max-w-none xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-12 w-full" />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="mb-2 h-7 w-40" />
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

import { PlainHeader } from "@/components/plain-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-agnostic loading shell (DESIGN 6.8): the header and neutral blocks.
 * A root `loading.tsx` cannot know the shape of the route behind it, and a
 * workspace-shaped skeleton would flash on the landing page; the workspace
 * shape arrives with U2, and `(auth)/loading.tsx` has its own.
 */
export default function Loading() {
  return (
    <>
      <PlainHeader />
      <main
        aria-busy="true"
        className="mx-auto flex w-full max-w-[68rem] flex-1 flex-col gap-6 px-4 pt-8 md:px-6 xl:px-8"
      >
        <div role="status">
          <span className="sr-only">Loading</span>
        </div>
        <Skeleton className="h-10 w-1/2" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full max-w-[38rem]" />
          <Skeleton className="h-4 w-5/6 max-w-[38rem]" />
        </div>
        <Skeleton className="h-48 w-full" />
      </main>
    </>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

/** Card-shaped placeholder inside the auth layout: h1, two fields, the button. */
export default function AuthLoading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-9 w-2/3" />
      <div className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-10 w-full pointer-coarse:h-12" />
          </div>
        ))}
        <Skeleton className="h-10 w-full pointer-coarse:h-11" />
      </div>
    </div>
  );
}

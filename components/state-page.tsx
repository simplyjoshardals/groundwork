import type { ReactNode } from "react";
import { PlainHeader } from "@/components/plain-header";
import { Card } from "@/components/ui/card";

/**
 * The shared frame for the 404, error and waiting pages (DESIGN 6.7, 6.8): a
 * plain header and one centered card with a serif h1. No hooks, so it works in
 * Server and Client Components alike. `plainLinks` is for `global-error`.
 */
export function StatePage({
  title,
  children,
  plainLinks = false,
}: {
  title: string;
  children: ReactNode;
  plainLinks?: boolean;
}) {
  return (
    <>
      <PlainHeader plain={plainLinks} />
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-8 md:items-center md:px-6">
        <Card
          padding="roomy"
          className="flex w-full max-w-[26rem] flex-col gap-6 md:p-8"
        >
          <h1 className="text-h1 font-semibold">{title}</h1>
          {children}
        </Card>
      </main>
    </>
  );
}

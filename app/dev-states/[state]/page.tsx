import { notFound } from "next/navigation";
import { CheckEmailNotice } from "@/components/check-email-notice";
import { PlainHeader } from "@/components/plain-header";
import { StatePage } from "@/components/state-page";
import { WaitingPage } from "@/components/waiting-page";
import { Card } from "@/components/ui/card";

/**
 * Development-only drill (U1): reaches the states that are hard to trigger by
 * hand. `waiting`, `error`, `loading` and `check-email`. Outside `next dev` it
 * is a 404, so it ships nothing to production.
 */
export default async function DevStatePage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { state } = await params;

  switch (state) {
    case "waiting":
      return <WaitingPage />;
    case "error":
      throw new Error("Forced error from /dev-states/error");
    case "loading":
      // Hold the route open so the nearest `loading.tsx` stays on screen.
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      return (
        <StatePage title="Loaded.">
          <p className="text-base text-ink">The loading state has ended.</p>
        </StatePage>
      );
    case "check-email":
      return (
        <>
          <PlainHeader />
          <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-8 md:items-center md:px-6">
            <Card padding="roomy" className="w-full max-w-[26rem] md:p-8">
              <CheckEmailNotice email="reader@example.com" />
            </Card>
          </main>
        </>
      );
    default:
      notFound();
  }
}

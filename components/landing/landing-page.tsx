import Link from "next/link";
import { CaptchaProvider, CaptchaSlot } from "@/components/captcha-provider";
import {
  DemoErrorNotice,
  DemoStartButton,
  DemoStartProvider,
} from "@/components/demo-start";
import { OfflineBanner } from "@/components/offline-banner";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Wordmark } from "@/components/wordmark";
import { authHref } from "@/lib/auth/shared-link";
import { EvalStrip } from "./eval-strip";
import { Guarantees } from "./guarantees";
import { Specimen } from "./specimen";

const CONTAINER = "mx-auto w-full max-w-[68rem] px-4 md:px-6 xl:px-8";

/**
 * The page a signed-out visitor sees at `/` (DESIGN 6.1). A server component;
 * only the Try demo buttons and the CAPTCHA widget are client code. One
 * `CaptchaProvider` serves the header and hero buttons, and the widget is
 * placed directly under the hero button, in a slot that reserves its height.
 * Moving the provider here (and keeping the `(auth)` one) means the signed-in
 * workspace never loads Turnstile.
 *
 * `next` is where Try demo and Sign in lead: `/`, or the viewer link the
 * visitor arrived with (already validated by `nextFromSearchParams`).
 */
export function LandingPage({ next }: { next: string }) {
  const signInHref = authHref("/sign-in", next);
  const sharedLink = next !== "/";

  return (
    <CaptchaProvider slot="manual">
      <DemoStartProvider next={next}>
        <header
          className={cn(CONTAINER, "flex h-14 items-center justify-between")}
        >
          <Wordmark rule />
          <div className="flex items-center gap-2">
            <Link
              href={signInHref}
              className={buttonClasses({ variant: "ghost" })}
            >
              Sign in
            </Link>
            <DemoStartButton placement="header" />
          </div>
        </header>
        <main
          className={cn(
            CONTAINER,
            "flex flex-1 flex-col gap-12 pb-12 pt-8 md:gap-16 md:pt-12",
          )}
        >
          <section
            aria-labelledby="landing-heading"
            className="grid gap-8 xl:grid-cols-2 xl:items-center xl:gap-12"
          >
            <div className="flex max-w-152 flex-col gap-6">
              <h1 id="landing-heading" className="text-display font-semibold">
                Answers that show their sources.
              </h1>
              <p className="text-lg text-muted">
                Ask your documents a question. Every claim links to the exact
                page, highlighted. If it isn’t in your documents, it says so.
              </p>
              {sharedLink ? (
                <Banner tone="info">
                  You opened a shared page. Try the demo or sign in to see it.
                </Banner>
              ) : null}
              <div className="flex flex-col gap-3">
                <OfflineBanner>
                  You’re offline. The demo needs a connection.
                </OfflineBanner>
                <div className="flex flex-wrap items-center gap-4">
                  <DemoStartButton placement="hero" />
                  <Link
                    href={signInHref}
                    className={buttonClasses({
                      variant: "link",
                      className:
                        "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center",
                    })}
                  >
                    Sign in
                  </Link>
                </div>
                <DemoErrorNotice />
                <CaptchaSlot />
              </div>
            </div>
            <Specimen />
          </section>
          <Guarantees />
          <EvalStrip metrics={null} />
          <section className="border-t border-line pt-6">
            <p className="max-w-152 text-sm text-muted">
              Don’t upload sensitive documents. Their text is sent to AI
              providers to answer questions.
            </p>
          </section>
        </main>
        <footer className="border-t border-line">
          <div
            className={cn(
              CONTAINER,
              "flex flex-col gap-2 py-8 sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <Wordmark />
            <p className="text-sm text-muted">
              Every claim carries its footnote.
            </p>
          </div>
        </footer>
      </DemoStartProvider>
    </CaptchaProvider>
  );
}

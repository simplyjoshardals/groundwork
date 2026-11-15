import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { TryDemoButton } from "@/components/try-demo-button";
import { buttonClasses } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionState } from "@/lib/auth/session";
import { authHref } from "@/lib/auth/shared-link";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const session = await getSessionState();
  // A demo (anonymous) user may still sign in to a real account.
  if (session.status === "signed_in" && !session.isAnonymous) redirect(next);

  const callbackFailed = first(params.error) === "callback";

  return (
    <AuthForm
      mode="sign-in"
      next={next}
      title="Sign in"
      notice={
        callbackFailed
          ? "That confirmation link is invalid or has expired. Sign in, or sign up again."
          : undefined
      }
      footer={
        <>
          <p className="text-sm text-muted">
            No account yet?{" "}
            <Link
              href={authHref("/sign-up", next)}
              className={buttonClasses({ variant: "link" })}
            >
              Create one
            </Link>
          </p>
          <hr className="border-line" />
          {session.status === "signed_in" ? (
            <Link
              href={next}
              className={buttonClasses({
                variant: "secondary",
                className: "w-full",
              })}
            >
              Continue with the demo session
            </Link>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">Just looking around?</p>
              <TryDemoButton next={next} />
            </div>
          )}
        </>
      }
    />
  );
}

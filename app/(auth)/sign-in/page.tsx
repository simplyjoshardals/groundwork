import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { TryDemoButton } from "@/components/try-demo-button";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionState } from "@/lib/auth/session";

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

  const signUpHref =
    next === "/" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;
  const callbackFailed = first(params.error) === "callback";

  return (
    <>
      <h2 className="text-lg font-medium">Sign in</h2>
      <AuthForm
        mode="sign-in"
        next={next}
        notice={
          callbackFailed
            ? "That confirmation link is invalid or has expired. Sign in, or sign up again."
            : undefined
        }
      />
      <p className="text-sm">
        No account yet?{" "}
        <Link href={signUpHref} className="underline">
          Create one
        </Link>
      </p>
      <hr className="border-gray-200" />
      {session.status === "signed_in" ? (
        <Link href={next} className="text-sm underline">
          Continue with the demo session
        </Link>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Just looking around?</p>
          <TryDemoButton next={next} />
        </div>
      )}
    </>
  );
}
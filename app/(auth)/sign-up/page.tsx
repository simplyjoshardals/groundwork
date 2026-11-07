import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionState } from "@/lib/auth/session";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const session = await getSessionState();
  // A demo (anonymous) user can reach this page to create a real account.
  if (session.status === "signed_in" && !session.isAnonymous) redirect(next);

  const signInHref =
    next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <>
      <h2 className="text-lg font-medium">Create an account</h2>
      <AuthForm mode="sign-up" next={next} />
      <p className="text-sm">
        Already have an account?{" "}
        <Link href={signInHref} className="underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

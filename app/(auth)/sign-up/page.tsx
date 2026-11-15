import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { buttonClasses } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionState } from "@/lib/auth/session";
import { authHref } from "@/lib/auth/shared-link";

export const metadata: Metadata = { title: "Create an account" };

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

  return (
    <AuthForm
      mode="sign-up"
      next={next}
      title="Create an account"
      footer={
        <p className="text-sm text-muted">
          Already have an account?{" "}
          <Link
            href={authHref("/sign-in", next)}
            className={buttonClasses({ variant: "link" })}
          >
            Sign in
          </Link>
        </p>
      }
    />
  );
}

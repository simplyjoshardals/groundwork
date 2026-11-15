import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/**
 * What replaces the sign-up form once Supabase has sent the confirmation link
 * (DESIGN 6.2 S). The wording stays non-committal on purpose: the same message
 * is shown for an address that is already registered, because Supabase does
 * not reveal that case. It is the page's only heading, so it is an `h1`
 * styled at the h2 size.
 */
export function CheckEmailNotice({ email }: { email: string | null }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <h1 className="text-h2 font-semibold">Check your email</h1>
      <p className="text-base text-ink">
        If{" "}
        {email ? (
          <span className="break-all font-mono text-sm">{email}</span>
        ) : (
          "that address"
        )}{" "}
        can be used to sign up, a confirmation link is on its way. Open it to
        finish creating your account.
      </p>
      <Link
        href="/sign-in"
        className={buttonClasses({ variant: "link", className: "self-start" })}
      >
        Back to sign in
      </Link>
    </div>
  );
}

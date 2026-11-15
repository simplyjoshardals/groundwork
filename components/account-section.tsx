import Link from "next/link";
import { SessionChip } from "@/components/session-chip";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonClasses } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/**
 * Session details for screens below `md`, where the header has no room for
 * them (DESIGN 5.15). From `md` the header shows the same things.
 */
export function AccountSection({
  isAnonymous,
  email,
}: {
  isAnonymous: boolean;
  email: string | null;
}) {
  return (
    <section
      aria-labelledby="account-heading"
      className={cn(cardClasses(), "flex flex-col gap-3 bg-sunken md:hidden")}
    >
      <h2 id="account-heading" className="text-sm font-medium">
        Account
      </h2>
      <SessionChip
        isAnonymous={isAnonymous}
        email={email}
        className="max-w-full self-start"
      />
      <div className="flex flex-wrap items-center gap-2">
        {isAnonymous ? (
          <Link
            href="/sign-up"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Create an account
          </Link>
        ) : null}
        <SignOutButton />
      </div>
    </section>
  );
}

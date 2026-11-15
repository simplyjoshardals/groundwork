import { SessionChip } from "@/components/session-chip";
import { SignOutButton } from "@/components/sign-out-button";
import { cardClasses } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/**
 * Session details for screens below `md`, where the header has no room for
 * them (DESIGN 5.15). A demo session's "Create an account" is the card in the
 * shelf right above, so it is not repeated here. From `md` the header shows the same things.
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
      <h2 id="account-heading" className="font-sans text-sm font-medium">
        Account
      </h2>
      <SessionChip
        isAnonymous={isAnonymous}
        email={email}
        className="max-w-full self-start"
      />
      <SignOutButton variant="secondary" className="self-start" />
    </section>
  );
}
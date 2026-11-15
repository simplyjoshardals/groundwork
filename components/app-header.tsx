import { HeaderFrame } from "@/components/header-frame";
import { QuestionCounter } from "@/components/question-counter";
import { SessionChip } from "@/components/session-chip";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

/**
 * The signed-in header (DESIGN 4.2): wordmark, question counter, theme toggle,
 * and from `md` the session chip and sign out. Below `md` the chip and sign out
 * live in the Account section under the shelf, so nothing here wraps at 360px.
 */
export function AppHeader({
  isAnonymous,
  email,
}: {
  isAnonymous: boolean;
  email: string | null;
}) {
  return (
    <HeaderFrame>
      <Wordmark className="shrink-0" />
      <div className="ml-auto flex min-w-0 items-center gap-1 md:gap-3">
        <QuestionCounter />
        {/* A wrapper, not a class on the chip: the chip sets its own `display`
            and the two utilities would fight (the chip won on phones). */}
        <div className="hidden items-center md:flex">
          <SessionChip isAnonymous={isAnonymous} email={email} />
        </div>
        <ThemeToggle />
        <div className="hidden items-center md:flex">
          <SignOutButton className="-mr-3" />
        </div>
      </div>
    </HeaderFrame>
  );
}
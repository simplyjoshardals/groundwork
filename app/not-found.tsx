import Link from "next/link";
import { StatePage } from "@/components/state-page";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <StatePage title="That page isn’t on the shelf.">
      <p className="text-base text-ink">The link may be old or mistyped.</p>
      <Link href="/" className={buttonClasses({ className: "self-start" })}>
        Go to Groundwork
      </Link>
    </StatePage>
  );
}

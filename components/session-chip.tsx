import { cn } from "@/components/ui/cn";

/** "Demo session" or the email, truncated so a long address never wraps. */
export function SessionChip({
  isAnonymous,
  email,
  className,
}: {
  isAnonymous: boolean;
  email: string | null;
  className?: string;
}) {
  const label = isAnonymous ? "Demo session" : (email ?? "Signed in");
  return (
    <span
      title={label}
      className={cn(
        "inline-block max-w-[14rem] truncate rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted",
        className,
      )}
    >
      {label}
    </span>
  );
}

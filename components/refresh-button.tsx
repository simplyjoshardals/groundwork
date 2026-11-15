"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Re-runs the server render of the page: "Try again" for server-fetched data. */
export function RefreshButton({ label = "Try again" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="min-w-24"
    >
      {pending ? "Trying…" : label}
    </Button>
  );
}

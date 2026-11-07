import type { Metadata } from "next";
import { ViewerCheck } from "./viewer-check";

export const metadata: Metadata = {
  title: "PDF viewer check",
  robots: { index: false },
};

/**
 * TEMPORARY (Task 3.2): the only place the viewer is mounted until Task 3.3
 * wires it to citations. Delete this folder in Task 3.3.
 */
export default function ViewerCheckPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">PDF viewer check</h1>
      <p className="text-sm text-neutral-600">
        Temporary page for Task 3.2. Choose &ldquo;Try demo&rdquo; on the home
        page first, so this session can open the sample.
      </p>
      <ViewerCheck />
    </main>
  );
}

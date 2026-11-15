import { StatePage } from "@/components/state-page";
import { WaitingContent } from "@/components/waiting-content";

/** Shown instead of the app when the auth service cannot be reached (Task 5.9). */
export function WaitingPage() {
  return (
    <StatePage title="Groundwork is waking up.">
      <WaitingContent />
    </StatePage>
  );
}

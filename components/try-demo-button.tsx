"use client";

import {
  DemoErrorNotice,
  DemoStartButton,
  DemoStartProvider,
} from "@/components/demo-start";

/**
 * The sign-in page's "Try demo": the button plus its failure banner, as one
 * unit. The request logic lives in `DemoStartProvider`, which the landing page
 * shares between its header and hero buttons.
 */
export function TryDemoButton({ next = "/" }: { next?: string }) {
  return (
    <DemoStartProvider next={next}>
      <div className="flex w-full flex-col gap-3">
        <DemoStartButton placement="auth" />
        <DemoErrorNotice />
      </div>
    </DemoStartProvider>
  );
}

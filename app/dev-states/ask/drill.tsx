"use client";

import { useState } from "react";
import { AskPanel } from "@/components/ask-panel";
import { OfflineBanner } from "@/components/offline-banner";
import { UsageProvider } from "@/components/usage-context";
import type { StreamSource } from "@/types/ask-stream";
import { SCENARIOS, type ScenarioName } from "./scenarios";

/** The ask panel wired to a scripted stream. Opening a source only logs it. */
export function AskDrill({
  scenario,
  showExamples,
}: {
  scenario: ScenarioName;
  showExamples: boolean;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <UsageProvider initial={null}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <OfflineBanner>
          You’re offline. Questions and uploads will work again when you’re
          back.
        </OfflineBanner>
        <AskPanel
          ask={SCENARIOS[scenario].stream}
          showExamples={showExamples}
          openChunkId={null}
          onOpenSource={(source: StreamSource) =>
            setOpened(`${source.documentTitle}, page ${source.page}`)
          }
        />
        {opened ? (
          <p role="status" className="font-mono text-xs text-muted">
            Would open: {opened}
          </p>
        ) : null}
      </div>
    </UsageProvider>
  );
}

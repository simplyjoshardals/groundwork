"use client";

import { useState } from "react";
import { DocumentsPanel } from "@/components/documents-panel";
import { ToastProvider } from "@/components/ui/toast";
import type { DocScenario } from "@/lib/documents/dev-scenario-names";
import { createScenario } from "@/lib/documents/dev-scenarios";

/**
 * The real documents panel against a scripted in-memory source (dev only; the
 * route 404s outside `next dev`). `now` comes from the server page so the
 * rows are built from one clock on the server and in the browser.
 */
export function DocumentsDrill({
  scenario,
  now,
}: {
  scenario: DocScenario;
  now: number;
}) {
  const [{ initial, source }] = useState(() => createScenario(scenario, now));
  return (
    <ToastProvider>
      <DocumentsPanel initial={initial} source={source} />
    </ToastProvider>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ViewerHost } from "@/components/viewer-host";
import { Button } from "@/components/ui/button";
import type { ViewerLocation } from "@/lib/viewer-url/location";
import { useRestoreFocus } from "@/lib/viewer/use-restore-focus";
import { SCENARIOS, type ScenarioName } from "./scenarios";

const FILLER =
  "Stand-in for the ask column. It is long on purpose, so the page behind the viewer scrolls: below 1280 px the open sheet must lock it, and at 1280 px and up it must stay put while the viewer sits in its own column.";

/**
 * The real viewer host against a scripted source. State is local (no URL), but
 * focus return, the docked and sheet shells and the exit animation are the
 * production ones. Resize across 1280 px to see both shells.
 */
export function ViewerDrill({ scenario }: { scenario: ScenarioName }) {
  const config = SCENARIOS[scenario];
  const source = useMemo(() => config.source(), [config]);
  const [location, setLocation] = useState<ViewerLocation>({
    status: "closed",
  });
  const open = location.status !== "closed";
  const rememberTrigger = useRestoreFocus(open);

  return (
    <div className="mx-auto grid w-full max-w-[84rem] items-start gap-8 px-4 py-8 xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="font-serif text-h2">Viewer drill: {scenario}</h1>
        <p className="text-sm text-muted">{config.title}</p>
        <div>
          <Button
            variant="secondary"
            data-citation-chunk={
              config.location.status === "open" ? config.location.chunkId : undefined
            }
            onClick={(event) => {
              rememberTrigger(
                event.currentTarget,
                config.location.status === "open"
                  ? config.location.chunkId
                  : null,
              );
              setLocation(config.location);
            }}
          >
            Open the citation
          </Button>
        </div>
        {Array.from({ length: 14 }, (_, index) => (
          <p key={index} className="text-sm text-muted">
            {FILLER}
          </p>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-20">
        <ViewerHost
          location={location}
          source={source}
          onClose={() => setLocation({ status: "closed" })}
          onPageChange={(page) =>
            setLocation((current) =>
              current.status === "open" ? { ...current, page } : current,
            )
          }
        />
      </div>
    </div>
  );
}

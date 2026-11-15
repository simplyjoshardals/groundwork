"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { AnswerText } from "@/components/answer-text";
import { Composer } from "@/components/composer";
import { ExampleQuestions } from "@/components/example-questions";
import { NotFoundNotice } from "@/components/not-found-notice";
import { SourceList } from "@/components/source-list";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsage } from "@/components/usage-context";
import {
  askReducer,
  describeFailure,
  initialAskState,
  requestAnswer,
} from "@/lib/ask-client";
import { useOnlineStatus } from "@/lib/net/use-online-status";
import { prefetchSource } from "@/lib/viewer-prefetch";
import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";

/** Where answers come from. The real one is `requestAnswer`; the dev drill swaps it. */
export type AskStream = (
  question: string,
  options: { signal: AbortSignal },
) => AsyncIterable<AskStreamEvent>;

const IDLE_LINE =
  "Ask about the documents on the shelf. Every claim comes with a source you can open.";

/**
 * Composer, example chips, streamed answer, source cards and every notice for
 * one conversation turn (DESIGN 6.4). The server re-validates everything; the
 * length limit in the composer is only quick feedback. `onOpenSource` is
 * called when a marker or a card's button is used. `showExamples` is true for
 * the demo and for accounts with no documents of their own (it is decided on
 * the server and does not change until the page reloads).
 */
export function AskPanel({
  onOpenSource,
  openChunkId = null,
  showExamples = false,
  ask: stream = requestAnswer,
}: {
  onOpenSource: (source: StreamSource, trigger: HTMLElement) => void;
  openChunkId?: string | null;
  showExamples?: boolean;
  ask?: AskStream;
}) {
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { publish } = useUsage();
  const online = useOnlineStatus();
  const router = useRouter();

  // The header counter shows the fresh budget that arrives with each answer.
  useEffect(() => {
    if (state.usage !== null) publish(state.usage);
  }, [state.usage, publish]);

  // Stop an in-flight request when the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = state.status === "loading" || state.status === "streaming";

  async function ask(question: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setActiveMarker(null);
    dispatch({ type: "submit", question });

    try {
      for await (const event of stream(question, {
        signal: controller.signal,
      })) {
        dispatch({ type: "event", event });
      }
    } catch (error) {
      // Our own abort (unmount or a newer question): nothing to show.
      if (controller.signal.aborted) return;
      console.error(
        "[ask] request failed:",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      );
      dispatch({ type: "failed", failure: describeFailure(error) });
    }
  }

  const idle = state.status === "idle";
  const waiting =
    state.status === "loading" ||
    (state.status === "streaming" && state.answer === "");
  const sourcesPending = busy && state.sources === null;
  const notice = state.notice;

  return (
    <section aria-label="Ask" className="flex flex-col gap-6">
      <Composer
        onSubmit={(question) => void ask(question)}
        busy={busy}
        offline={!online}
      />

      {idle ? (
        <div className="flex flex-col gap-4">
          <p className="text-pretty text-muted">{IDLE_LINE}</p>
          {showExamples ? (
            <ExampleQuestions
              onAsk={(question) => void ask(question)}
              disabled={busy || !online}
            />
          ) : null}
        </div>
      ) : (
        <div aria-busy={busy} className="flex flex-col gap-6">
          <h2 className="max-w-[36rem] font-serif text-read text-muted">
            {state.question}
          </h2>

          {waiting ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm text-muted">
                {state.status === "loading"
                  ? "Searching your documents…"
                  : "Writing the answer…"}
              </p>
              <AnswerSkeleton />
            </div>
          ) : null}

          {state.answer !== "" ? (
            <div className="flex flex-col gap-2">
              {state.status === "error" ? (
                <p className="text-xs text-muted">Incomplete answer</p>
              ) : null}
              <AnswerText
                text={state.answer}
                sources={state.sources}
                streaming={state.status === "streaming"}
                activeMarker={activeMarker}
                openChunkId={openChunkId}
                onHighlight={setActiveMarker}
                onPrefetch={prefetchSource}
                onOpenSource={onOpenSource}
              />
            </div>
          ) : null}

          {state.status === "done" && state.answer === "" ? (
            <Banner tone="info">
              No answer was generated. Try rephrasing the question.
            </Banner>
          ) : null}

          {state.status === "not_found" && notice ? (
            <NotFoundNotice
              message={notice.message}
              closest={state.closest}
              onOpenSource={onOpenSource}
            />
          ) : notice ? (
            <Banner
              tone={notice.tone ?? "danger"}
              action={
                notice.action === "new-session" ? (
                  // Re-runs the server page, which re-checks the dead session
                  // and shows the landing page (with Try demo).
                  <Button size="sm" onClick={() => router.refresh()}>
                    Start a new demo
                  </Button>
                ) : notice.retryable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void ask(state.question)}
                  >
                    Retry
                  </Button>
                ) : null
              }
            >
              {notice.message}
            </Banner>
          ) : null}

          {sourcesPending ? <SourcesSkeleton /> : null}
          {state.sources && state.status !== "not_found" ? (
            <div className="animate-fade-in">
              <SourceList
                sources={state.sources}
                activeMarker={activeMarker}
                onHighlight={setActiveMarker}
                onOpenSource={onOpenSource}
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Three lines at answer height, the last one 60% wide (DESIGN 5.9). */
function AnswerSkeleton() {
  return (
    <div className="flex max-w-[36rem] flex-col gap-[0.6rem]" aria-hidden="true">
      <Skeleton className="h-[1.1rem] w-full" />
      <Skeleton className="h-[1.1rem] w-full" />
      <Skeleton className="h-[1.1rem] w-3/5" />
    </div>
  );
}

/** Two source-card shapes (DESIGN 5.9). */
function SourcesSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1].map((key) => (
        <div
          key={key}
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
        >
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}
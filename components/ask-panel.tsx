"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { AnswerText } from "@/components/answer-text";
import { NotFoundNotice } from "@/components/not-found-notice";
import { SourceList } from "@/components/source-list";
import {
  askReducer,
  describeFailure,
  initialAskState,
  requestAnswer,
} from "@/lib/ask-client";
import { MAX_QUESTION_LENGTH } from "@/lib/ask/limits";
import type { StreamSource } from "@/types/ask-stream";

/**
 * Question box, streamed answer and source list. The server re-validates
 * everything; the length limit here is only quick feedback. `onOpenSource`
 * is called when a citation chip is clicked.
 */
export function AskPanel({
  onOpenSource,
}: {
  onOpenSource: (source: StreamSource, trigger: HTMLElement) => void;
}) {
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Stop an in-flight request when the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = state.status === "loading" || state.status === "streaming";

  async function ask(question: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "submit", question });

    try {
      for await (const event of requestAnswer(question, {
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

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (busy || question.length === 0) return;
    void ask(question);
  }

  const showWaiting =
    state.status === "loading" ||
    (state.status === "streaming" && state.answer === "");

  return (
    <section className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="ask-question" className="text-sm font-medium">
          Ask a question about the sample documents
        </label>
        <div className="flex gap-2">
          <input
            id="ask-question"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={MAX_QUESTION_LENGTH}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>

      {state.status === "idle" ? null : (
        <div aria-busy={busy} className="flex flex-col gap-4">
          <h2 className="text-sm text-neutral-500">{state.question}</h2>

          {showWaiting ? (
            <p role="status" className="text-sm text-neutral-600">
              {state.status === "loading"
                ? "Searching the documents…"
                : "Writing the answer…"}
            </p>
          ) : null}

          {state.answer !== "" ? (
            <div className="flex flex-col gap-1">
              {state.status === "error" ? (
                <p className="text-xs font-medium text-neutral-500">
                  Incomplete answer
                </p>
              ) : null}
              <AnswerText
                text={state.answer}
                sources={state.sources}
                streaming={state.status === "streaming"}
                onOpenSource={onOpenSource}
              />
            </div>
          ) : null}

          {state.status === "done" && state.answer === "" ? (
            <p className="text-sm text-neutral-600">
              No answer was generated. Try rephrasing the question.
            </p>
          ) : null}

          {state.status === "not_found" && state.notice ? (
            <NotFoundNotice
              message={state.notice.message}
              closest={state.closest}
            />
          ) : state.notice ? (
            <div
              role={state.status === "error" ? "alert" : "status"}
              className="flex flex-col items-start gap-2 text-sm"
            >
              <p className={state.status === "error" ? "text-red-600" : ""}>
                {state.notice.message}
              </p>
              {state.notice.retryable ? (
                <button
                  type="button"
                  onClick={() => void ask(state.question)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {state.sources ? <SourceList sources={state.sources} /> : null}
        </div>
      )}
    </section>
  );
}

import { describe, expect, it } from "vitest";
import {
  askReducer,
  initialAskState,
  type AskAction,
  type AskState,
} from "@/lib/ask-client";
import type { AskStreamEvent, StreamSource } from "@/lib/ask-stream";

const SOURCE: StreamSource = {
  marker: 1,
  documentId: "11111111-1111-4111-8111-111111111111",
  documentTitle: "Handbook",
  page: 3,
  snippet: "Remote work is allowed.",
};

function run(actions: AskAction[], from: AskState = initialAskState): AskState {
  return actions.reduce(askReducer, from);
}

function event(e: AskStreamEvent): AskAction {
  return { type: "event", event: e };
}

const submit: AskAction = { type: "submit", question: "How many days?" };

describe("askReducer", () => {
  it("starts idle with nothing to show", () => {
    expect(initialAskState.status).toBe("idle");
    expect(initialAskState.sources).toBeNull();
    expect(initialAskState.notice).toBeNull();
    expect(initialAskState.closest).toEqual([]);
  });

  it("submit moves to loading and clears the previous answer", () => {
    const previous = run([
      submit,
      event({ type: "token", text: "old" }),
      event({ type: "done", citations: [], invalidCitations: [] }),
    ]);
    const next = askReducer(previous, { type: "submit", question: "New?" });
    expect(next).toEqual({
      status: "loading",
      question: "New?",
      sources: null,
      answer: "",
      notice: null,
      closest: [],
    });
  });

  it("submit clears closest passages left by a previous not_found", () => {
    const previous = run([
      submit,
      event({ type: "not_found", closest: [SOURCE] }),
    ]);
    expect(previous.closest).toEqual([SOURCE]);
    expect(askReducer(previous, submit).closest).toEqual([]);
  });

  it("shows sources first, then accumulates tokens, then finishes", () => {
    let state = run([submit, event({ type: "sources", sources: [SOURCE] })]);
    expect(state.status).toBe("streaming");
    expect(state.sources).toEqual([SOURCE]);
    expect(state.answer).toBe("");

    state = run(
      [
        event({ type: "token", text: "Two " }),
        event({ type: "token", text: "days [1]." }),
        event({ type: "done", citations: [], invalidCitations: [] }),
      ],
      state,
    );
    expect(state.status).toBe("done");
    expect(state.answer).toBe("Two days [1].");
    expect(state.sources).toEqual([SOURCE]);
  });

  it("tells an empty sources list apart from no sources event yet", () => {
    const waiting = run([submit]);
    expect(waiting.sources).toBeNull();
    const empty = run([submit, event({ type: "sources", sources: [] })]);
    expect(empty.sources).toEqual([]);
  });

  it("keeps partial text when an in-stream error ends the answer", () => {
    const state = run([
      submit,
      event({ type: "sources", sources: [SOURCE] }),
      event({ type: "token", text: "Partial" }),
      event({ type: "error", code: "interrupted", message: "ignored" }),
    ]);
    expect(state.status).toBe("error");
    expect(state.answer).toBe("Partial");
    expect(state.sources).toEqual([SOURCE]);
    expect(state.notice?.retryable).toBe(true);
    // The client's own wording is shown, never the server's message.
    expect(state.notice?.message).not.toContain("ignored");
  });

  it("gives every error code a retryable message", () => {
    for (const code of [
      "search_unavailable",
      "llm_unavailable",
      "interrupted",
      "internal_error",
    ] as const) {
      const state = run([submit, event({ type: "error", code, message: "x" })]);
      expect(state.status).toBe("error");
      expect(state.notice?.message.length).toBeGreaterThan(0);
      expect(state.notice?.retryable).toBe(true);
    }
  });

  it("shows a message for not_found and limit, without Retry", () => {
    const notFound = run([submit, event({ type: "not_found" })]);
    expect(notFound.status).toBe("not_found");
    expect(notFound.notice?.retryable).toBe(false);

    const user = run([submit, event({ type: "limit", scope: "user" })]);
    const global = run([submit, event({ type: "limit", scope: "global" })]);
    expect(user.status).toBe("limit");
    expect(global.status).toBe("limit");
    expect(user.notice?.message).not.toBe(global.notice?.message);
    expect(user.notice?.retryable).toBe(false);
  });

  it("keeps the closest passages from a not_found event", () => {
    const state = run([
      submit,
      event({ type: "not_found", closest: [SOURCE] }),
    ]);
    expect(state.status).toBe("not_found");
    expect(state.closest).toEqual([SOURCE]);
    // No `sources` event precedes a refusal, so no source list is shown.
    expect(state.sources).toBeNull();
    expect(state.answer).toBe("");
  });

  it("uses an empty closest list when not_found carries none", () => {
    expect(run([submit, event({ type: "not_found" })]).closest).toEqual([]);
    expect(
      run([submit, event({ type: "not_found", closest: [] })]).closest,
    ).toEqual([]);
  });

  it("a thrown failure ends the answer as an error and keeps partial text", () => {
    const state = run([
      submit,
      event({ type: "token", text: "Half" }),
      { type: "failed", failure: { message: "Lost.", retryable: true } },
    ]);
    expect(state.status).toBe("error");
    expect(state.answer).toBe("Half");
    expect(state.notice).toEqual({ message: "Lost.", retryable: true });
  });

  it("ignores events and failures that arrive when nothing is active", () => {
    const done = run([
      submit,
      event({ type: "token", text: "Final" }),
      event({ type: "done", citations: [], invalidCitations: [] }),
    ]);
    expect(askReducer(done, event({ type: "token", text: " late" }))).toBe(
      done,
    );
    expect(
      askReducer(done, {
        type: "failed",
        failure: { message: "late", retryable: true },
      }),
    ).toBe(done);
    expect(
      askReducer(initialAskState, event({ type: "token", text: "x" })),
    ).toBe(initialAskState);
  });
});

// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskPanel, type AskStream } from "@/components/ask-panel";
import { UsageProvider } from "@/components/usage-context";
import { AskHttpError, AskNetworkError } from "@/lib/ask-client";
import type { AskStreamEvent, StreamSource } from "@/types/ask-stream";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const prefetch = vi.fn();
vi.mock("@/lib/viewer-prefetch", () => ({
  prefetchSource: (source: StreamSource) => prefetch(source),
}));

afterEach(() => {
  cleanup();
  prefetch.mockReset();
  refresh.mockReset();
  vi.restoreAllMocks();
});

const source = (marker: number, title = "Handbook"): StreamSource => ({
  marker,
  documentId: `00000000-0000-4000-8000-00000000000${marker}`,
  chunkId: 100 + marker,
  documentTitle: title,
  page: marker + 2,
  snippet: `Snippet ${marker}`,
});

const DONE: AskStreamEvent = {
  type: "done",
  citations: [1],
  invalidCitations: [],
};

/** A stream the test pushes events into, one at a time. */
function controlled() {
  const queue: AskStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  const stream: AskStream = async function* () {
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift() as AskStreamEvent;
        continue;
      }
      if (failure) throw failure;
      if (finished) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  };
  const poke = () => {
    wake?.();
    wake = null;
  };
  return {
    stream,
    push: async (...events: AskStreamEvent[]) => {
      await act(async () => {
        queue.push(...events);
        poke();
      });
    },
    fail: async (error: unknown) => {
      await act(async () => {
        failure = error;
        poke();
      });
    },
    end: async () => {
      await act(async () => {
        finished = true;
        poke();
      });
    },
  };
}

function setup(
  stream: AskStream,
  props: { showExamples?: boolean; onOpenSource?: () => void } = {},
) {
  return render(
    <UsageProvider initial={null}>
      <AskPanel
        ask={stream}
        onOpenSource={props.onOpenSource ?? vi.fn()}
        showExamples={props.showExamples}
      />
    </UsageProvider>,
  );
}

async function ask(text: string) {
  const box = screen.getByLabelText("Ask a question about your documents");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  await act(async () => {});
}

describe("AskPanel idle state", () => {
  it("shows the line and no chips for an account with its own documents", () => {
    setup(controlled().stream);
    expect(screen.getByText(/Every claim comes with a source/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Example questions" })).toBeNull();
  });

  it("asks the chip's full question as soon as it is clicked", async () => {
    const seen: string[] = [];
    const stream: AskStream = async function* (question) {
      seen.push(question);
      yield DONE;
    };
    setup(stream, { showExamples: true });
    expect(
      screen.getByRole("region", { name: "Example questions" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Try one it can’t answer" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fire assembly point" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatch(/fire assembly point/);
  });
});

describe("Composer", () => {
  it("submits on Enter, adds a line on Shift+Enter, ignores Enter while composing", async () => {
    const stream = vi.fn<AskStream>(async function* () {
      yield DONE;
    });
    setup(stream);
    const box = screen.getByLabelText("Ask a question about your documents");

    fireEvent.change(box, { target: { value: "first" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(stream).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    expect(stream.mock.calls[0][0]).toBe("first");
  });

  it("keeps Ask disabled until there is text, and shows a counter only near the limit", () => {
    setup(controlled().stream);
    const button = screen.getByRole("button", { name: "Ask" });
    const box = screen.getByLabelText("Ask a question about your documents");
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(box, { target: { value: "short" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("5/500").className).toContain("invisible");

    fireEvent.change(box, { target: { value: "x".repeat(450) } });
    expect(screen.getByText("450/500").className).not.toContain("invisible");
  });

  it("pauses asking and says why while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    setup(controlled().stream, { showExamples: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    const box = screen.getByLabelText("Ask a question about your documents");
    fireEvent.change(box, { target: { value: "anything" } });
    expect(screen.getByText(/You’re offline/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Fire assembly point",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("streaming answer", () => {
  it("shows the waiting line, then paragraphs with named markers and source cards", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("How many days?");
    expect(screen.getByRole("status").textContent).toBe(
      "Searching your documents…",
    );

    await c.push({ type: "sources", sources: [source(1), source(2, "Policy")] });
    expect(screen.getByRole("status").textContent).toBe("Writing the answer…");

    await c.push(
      { type: "token", text: "Twenty-six days [1]." },
      { type: "token", text: "\n\nSee also the policy [2]." },
      DONE,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Source 1: Handbook, page 3" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Source 2: Policy, page 4" }),
    ).toBeTruthy();
    const cards = within(
      screen.getByRole("region", { name: "Sources" }),
    ).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(screen.getByText(/Twenty-six days/).closest("p")).not.toBe(
      screen.getByText(/See also the policy/).closest("p"),
    );
  });

  it("lights the matching card from a marker, and the marker from a card", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.push(
      { type: "sources", sources: [source(1), source(2)] },
      { type: "token", text: "A [1] and B [2]." },
      DONE,
    );
    const marker = screen.getByRole("button", {
      name: "Source 2: Handbook, page 4",
    });
    const cards = screen.getAllByRole("listitem");

    fireEvent.mouseEnter(marker);
    expect(cards[1].getAttribute("aria-current")).toBe("true");
    expect(cards[0].getAttribute("aria-current")).toBeNull();
    fireEvent.mouseLeave(marker);
    expect(cards[1].getAttribute("aria-current")).toBeNull();

    fireEvent.focus(cards[0]);
    expect(
      screen
        .getByRole("button", { name: "Source 1: Handbook, page 3" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("warms the viewer lookups when a marker is hovered or focused, and opens on click", async () => {
    const onOpenSource = vi.fn();
    const c = controlled();
    setup(c.stream, { onOpenSource });
    await ask("q");
    await c.push(
      { type: "sources", sources: [source(1)] },
      { type: "token", text: "A [1]." },
      DONE,
    );
    const marker = screen.getByRole("button", {
      name: "Source 1: Handbook, page 3",
    });
    fireEvent.mouseEnter(marker);
    fireEvent.focus(marker);
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledWith(expect.objectContaining({ marker: 1 }));

    fireEvent.click(marker);
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({ marker: 1 }),
      marker,
    );
  });

  it("never shows a marker that matches no source", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.push(
      { type: "sources", sources: [source(1)] },
      { type: "token", text: "Real [1] and made up [7]." },
      DONE,
    );
    expect(screen.getAllByRole("button", { name: /^Source / })).toHaveLength(1);
    expect(screen.queryByText(/\[7\]/)).toBeNull();
  });
});

describe("refusal", () => {
  it("is a neutral status card with no Retry, and offers the closest passages", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("dress code?");
    await c.push({ type: "not_found", closest: [source(1)] });

    const card = screen.getByRole("status");
    expect(card.textContent).toContain("I couldn't find that in your documents.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Closest passages (1)")).toBeTruthy();
  });
});

describe("errors, limits and fallbacks", () => {
  it("shows a danger alert with Retry for an error before any text, and Retry asks again", async () => {
    const calls: string[] = [];
    let first = true;
    const stream: AskStream = async function* (question) {
      calls.push(question);
      if (first) {
        first = false;
        yield { type: "error", code: "internal_error", message: "x" } as AskStreamEvent;
        return;
      }
      yield DONE;
    };
    setup(stream);
    await ask("why?");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toEqual(["why?", "why?"]));
  });

  it("keeps the partial answer and labels it when the stream breaks", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.push(
      { type: "sources", sources: [source(1)] },
      { type: "token", text: "Half an answer" },
    );
    await c.push({ type: "error", code: "interrupted", message: "x" } as AskStreamEvent);
    expect(screen.getByText("Incomplete answer")).toBeTruthy();
    expect(screen.getByText("Half an answer")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("treats a dropped connection as a warning with Retry", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.fail(new AskNetworkError());
    expect(screen.getByRole("status").textContent).toContain("Connection lost");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows a daily limit as a status banner with no Retry", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.push({
      type: "limit",
      scope: "user",
      reason: "user_limit",
      resetsAt: "2026-11-16T00:00:00.000Z",
    });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("You've used today's questions");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers a new demo (refreshing the page) when the session has expired", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.fail(new AskHttpError(401));
    fireEvent.click(screen.getByRole("button", { name: "Start a new demo" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("explains the provider fallback as a note above the passages", async () => {
    const c = controlled();
    setup(c.stream);
    await ask("q");
    await c.push(
      { type: "sources", sources: [source(1)] },
      { type: "error", code: "llm_unavailable", message: "x" } as AskStreamEvent,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "closest passages I found are listed below",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region", { name: "Sources" })).toBeTruthy();
  });
});
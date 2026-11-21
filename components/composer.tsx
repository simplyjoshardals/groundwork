"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { MAX_QUESTION_LENGTH } from "@/lib/ask/limits";

const MAX_LINES = 4;
/** The counter appears once the text passes this share of the limit. */
const COUNTER_FROM = 0.8;

/**
 * The ask box (DESIGN 5.2): a serif auto-growing textarea (1 to 4 lines) with
 * the submit button inside, bottom right. Enter submits, Shift+Enter adds a
 * line; Enter while an input method is composing (IME) is left alone. The
 * focus ring is on the container, because the textarea is not the visual
 * edge of the control. The helper row under it is always there (it holds the
 * counter or the offline note), so its text never moves the page.
 */
export function Composer({
  onSubmit,
  busy,
  offline,
}: {
  onSubmit: (question: string) => void;
  busy: boolean;
  offline: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const helperId = useId();
  const trimmed = value.trim();
  const canSubmit = !busy && !offline && trimmed.length > 0;
  const showCounter = value.length > MAX_QUESTION_LENGTH * COUNTER_FROM;

  // Grow with the text up to MAX_LINES, then scroll inside.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const padding =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom);
    const max = Number.isFinite(lineHeight)
      ? lineHeight * MAX_LINES + padding
      : Infinity;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value]);

  function submit() {
    if (!canSubmit) return;
    onSubmit(trimmed);
    setValue("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={onFormSubmit} className="flex flex-col gap-1.5">
      <label htmlFor="ask-question" className="sr-only">
        Ask a question about your documents
      </label>
      <div className="flex items-end gap-2 rounded-lg border border-control bg-surface p-2 transition-colors duration-(--dur-fast) focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
        <textarea
          id="ask-question"
          ref={ref}
          rows={1}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            setValue(event.target.value)
          }
          onKeyDown={onKeyDown}
          maxLength={MAX_QUESTION_LENGTH}
          autoComplete="off"
          placeholder="Ask a question…"
          aria-describedby={helperId}
          className="min-h-10 min-w-0 flex-1 pointer-coarse:min-h-11 resize-none bg-transparent px-2 py-1 font-serif text-read text-ink outline-none placeholder:text-muted"
        />
        <Button
          type="submit"
          disabled={!canSubmit}
          className="min-w-24 shrink-0"
        >
          {busy ? "Asking…" : "Ask"}
        </Button>
      </div>
      <p
        id={helperId}
        className="flex min-h-4 justify-between gap-3 text-xs text-muted"
      >
        <span>{offline ? "You’re offline. Asking is paused." : null}</span>
        <span
          className={cn("font-mono tabular-nums", !showCounter && "invisible")}
        >
          {value.length}/{MAX_QUESTION_LENGTH}
        </span>
      </p>
    </form>
  );
}

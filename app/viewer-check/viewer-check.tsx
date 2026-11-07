"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import { PdfViewer } from "@/components/pdf-viewer-loader";

const SAMPLE_PATH = "samples/kestrel-vane-employee-handbook.pdf";

/** Opens the handbook sample at a page chosen in a small form. */
export function ViewerCheck() {
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("1");

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number.parseInt(input, 10);
    if (Number.isNaN(parsed)) return;
    setPage(parsed);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="viewer-check-page" className="text-sm font-medium">
            Go to page
          </label>
          <input
            id="viewer-check-page"
            type="number"
            min={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="w-24 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Go
        </button>
      </form>

      <PdfViewer
        storagePath={SAMPLE_PATH}
        page={page}
        onPageChange={(next) => {
          setPage(next);
          setInput(String(next));
        }}
      />
    </div>
  );
}

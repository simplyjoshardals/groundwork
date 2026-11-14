"use client";

/** Full reload, so the server re-checks the session (Task 5.9 waiting page). */
export function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="w-fit rounded-md border border-control px-3 py-1 text-sm"
    >
      Try again
    </button>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "@/lib/theme/theme-script";

function apply(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the change still applies for this page view.
  }
  const dark =
    choice === "dark" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/** TEMPORARY (U0). The real toggle arrives in U2. Delete with this folder. */
export function ThemeSwitch() {
  return (
    <div role="group" aria-label="Theme" className="flex flex-wrap gap-2">
      {THEME_CHOICES.map((choice) => (
        <Button
          key={choice}
          variant="secondary"
          size="sm"
          onClick={() => apply(choice)}
        >
          {choice === "light" ? "Light" : choice === "dark" ? "Dark" : "System"}
        </Button>
      ))}
    </div>
  );
}

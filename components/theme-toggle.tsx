"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/ui/icons";
import {
  nextThemeChoice,
  readThemeChoice,
  setThemeChoice,
  subscribeToTheme,
  THEME_LABEL,
} from "@/lib/theme/apply-theme";
import type { ThemeChoice } from "@/lib/theme/theme-script";

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/**
 * Three-state theme button (DESIGN 5.12). The server and the first client
 * render both show System (the server cannot read storage); the real choice
 * appears right after hydration, in a box of the same size.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore<ThemeChoice>(
    subscribeToTheme,
    readThemeChoice,
    () => "system",
  );
  const next = nextThemeChoice(choice);
  const Icon = ICONS[choice];
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${THEME_LABEL[choice]}. Switch to ${THEME_LABEL[next]}.`}
      title={`Theme: ${THEME_LABEL[choice]}`}
      onClick={() => setThemeChoice(next)}
    >
      <Icon />
    </Button>
  );
}

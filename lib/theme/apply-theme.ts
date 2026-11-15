import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "./theme-script";

/** Same-tab change signal (the `storage` event only fires in other tabs). */
const CHANGE_EVENT = "groundwork-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((c) => c === value);
}

/** The stored choice; `system` when nothing usable is stored or storage is blocked. */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Sets `data-theme` the way the head script does: always light or dark. */
export function applyThemeChoice(choice: ThemeChoice): void {
  let dark = choice === "dark";
  if (choice === "system") {
    try {
      dark = matchMedia(DARK_QUERY).matches;
    } catch {
      dark = false;
    }
  }
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/** Stores and applies a choice, and tells subscribers in this tab. */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the change still applies for this page view.
  }
  applyThemeChoice(choice);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** System, then Light, then Dark, then back to System. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  if (choice === "system") return "light";
  if (choice === "light") return "dark";
  return "system";
}

/**
 * For `useSyncExternalStore`. Notifies on a change in this tab or another, and
 * re-applies the theme when the OS preference flips while the choice is
 * `system` (the head script only runs once, at load).
 */
export function subscribeToTheme(onChange: () => void): () => void {
  let media: MediaQueryList | null = null;
  try {
    media = matchMedia(DARK_QUERY);
  } catch {
    media = null;
  }
  const onOsChange = () => {
    if (readThemeChoice() === "system") applyThemeChoice("system");
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyThemeChoice(readThemeChoice());
    onChange();
  };
  media?.addEventListener("change", onOsChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media?.removeEventListener("change", onOsChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

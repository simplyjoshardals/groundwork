/**
 * The theme contract (DESIGN 1.1). U2's toggle reads and writes the same key.
 * `system` (or no stored value, or anything unrecognised) follows the OS.
 */
export const THEME_STORAGE_KEY = "groundwork-theme";

export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/**
 * A tiny blocking script, rendered inline in `<head>` so `data-theme` is set
 * before first paint (no flash of the wrong theme). It stays plain ES5: it
 * runs before anything else and must never throw, so storage and `matchMedia`
 * failures fall back to light instead of breaking the page.
 *
 * It runs once, at load. Following OS changes mid-session is U2's job.
 */
export const THEME_SCRIPT = `(function(){
  var root = document.documentElement;
  var choice = "system";
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (stored === "light" || stored === "dark" || stored === "system") choice = stored;
  } catch (e) {}
  var dark = choice === "dark";
  if (choice === "system") {
    try { dark = matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
  }
  root.setAttribute("data-theme", dark ? "dark" : "light");
})();`;

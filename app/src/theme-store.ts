/**
 * FLOW-372: the appearance choice, saved per device (localStorage), not per business.
 * "system" (the default) follows prefers-color-scheme and removes data-theme from <html>; "light"
 * and "dark" set it, and the tokens in design/system/implementation-tokens.css read it.
 * index.html applies the saved choice before first paint with the same key ("flow.theme"), so a
 * reload never flashes the other theme. Change the key in both places.
 */
export type ThemeChoice = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "flow.theme";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** The saved choice, or "system" when none is saved, the value is unknown, or storage is blocked. */
export function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** Sets data-theme for the choice: none for "system", the choice itself otherwise. */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

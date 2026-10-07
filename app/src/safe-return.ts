/**
 * Where onboarding may send the owner. Anything else, including a normalised
 * `//host`, goes home. `safeAppPath` accepts two paths; `safeSignInReturn` a
 * short list of screens (FLOW-308).
 */
const SETTINGS = "/settings";
const SETTINGS_SUMIT = "/settings?sheet=sumit";

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalisedPath(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value, "https://flow.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://flow.invalid" || url.username !== "" || url.password !== "") return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.startsWith("//") || decoded.startsWith("//") || path.includes("\\") || decoded.includes("\\")) return null;
  return path;
}

/** `/settings` or `/settings?sheet=sumit`. Every other value is dropped. */
export function safeAppPath(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (value !== value.trim() || hasControlChar(value)) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\") || value.includes("://") || value.includes("@")) return null;
  const path = normalisedPath(value);
  if (path == null || path.startsWith("//") || path.includes("\\")) return null;
  if (path !== SETTINGS && path !== SETTINGS_SUMIT) return null;
  return path;
}

/**
 * Screens a signed-out deep link may return to after sign-in, with the words the
 * auth callback shows on the way. Exact paths only.
 */
const SIGN_IN_RETURNS: ReadonlyMap<string, string> = new Map([
  ["/review", "לאישור"],
  ["/review/all", "לאישור"],
  ["/review/filed", "לתנועות ששויכו היום"],
  ["/unpaid", "לחשבוניות שלא שולמו"],
  ["/notifications", "להתראות"],
  ["/projects", "לפרויקטים"],
  [SETTINGS, "להגדרות"],
  ["/settings/categories", "לקטגוריות"],
  [SETTINGS_SUMIT, "להגדרות"],
]);

/** A path from {@link SIGN_IN_RETURNS}, or null. Home is not a return: it is the default. */
export function safeSignInReturn(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (value !== value.trim() || hasControlChar(value)) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\") || value.includes("://") || value.includes("@")) return null;
  const path = normalisedPath(value);
  if (path == null || path !== value || !SIGN_IN_RETURNS.has(path)) return null;
  return path;
}

const RETURN_KEY = "flow.sign-in-return";

/** Keeps the return path across the Google redirect. Null clears it. */
export function rememberSignInReturn(path: string | null): void {
  try {
    const safe = safeSignInReturn(path);
    if (safe) window.sessionStorage.setItem(RETURN_KEY, safe);
    else window.sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Storage can be blocked; the user then lands on Home.
  }
}

/**
 * Reads the stored return path without clearing it. The auth callback clears it
 * only once it navigates, so a re-run effect (React StrictMode) still sees it.
 */
export function peekSignInReturn(): string | null {
  try {
    return safeSignInReturn(window.sessionStorage.getItem(RETURN_KEY));
  } catch {
    return null;
  }
}

/** Reads and clears the stored return path. */
export function takeSignInReturn(): string | null {
  const value = peekSignInReturn();
  rememberSignInReturn(null);
  return value;
}

/** Where the auth callback goes: setup first for a new user, else the stored return or Home. */
export function afterSignInPath(hasCompany: boolean, stored: string | null): string {
  if (!hasCompany) return "/setup/0";
  return safeSignInReturn(stored) ?? "/";
}

/** The callback's line once the session is known. The words come from the allowlist, never the URL. */
export function afterSignInMessage(hasCompany: boolean, stored: string | null): string {
  if (!hasCompany) return "נכנסתם. ממשיכים לפרטי העסק.";
  const safe = safeSignInReturn(stored);
  return `נכנסתם. עוברים ${(safe && SIGN_IN_RETURNS.get(safe)) ?? "לבית"}.`;
}

/** The sign-in URL for a signed-out visit to `path` (pathname plus search). */
export function signInPathFor(path: string): string {
  const safe = safeSignInReturn(path);
  return safe ? `/sign-in?return=${encodeURIComponent(safe)}` : "/sign-in";
}

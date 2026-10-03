/**
 * Where onboarding may send the owner. Anything else, including a normalised
 * `//host`, goes home. Only these two paths are accepted.
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

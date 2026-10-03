/**
 * A path inside this app. Anything else is dropped so `return` cannot redirect away.
 * The default caller is Home.
 */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function safeAppPath(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (hasControlChar(value)) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null;
  if (trimmed.includes("\\") || trimmed.includes("://")) return null;
  let url: URL;
  try {
    url = new URL(trimmed, "https://flow.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://flow.invalid" || url.username !== "" || url.password !== "") return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

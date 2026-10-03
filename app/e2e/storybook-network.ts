export type StorybookRequestKind = "allow" | "request" | "service-worker";

/**
 * The Storybook smoke server is http on 127.0.0.1 or localhost, on the test port.
 * data: and blob: stay in the page. Every other URL is blocked, including supabase.in and custom domains.
 */
export function isAllowedStorybookUrl(raw: string, port: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  const web = url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:";
  if (!web) return false;
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  return url.port === port;
}

/** A service worker uses the same allowlist. A blocked worker request is named so it is not a plain fetch. */
export function classifyStorybookRequest(raw: string, port: string, fromServiceWorker: boolean): StorybookRequestKind {
  if (isAllowedStorybookUrl(raw, port)) return "allow";
  return fromServiceWorker ? "service-worker" : "request";
}

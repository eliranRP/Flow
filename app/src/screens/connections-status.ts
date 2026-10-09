/** Pure helpers for the Connections screen (connections-screen.tsx). */

export type SumitKind = "loading" | "error" | "reconnect" | "connected" | "disconnected";

export function sumitKind(input: {
  forced: "loading" | "error" | null;
  noCompany: boolean;
  statusLoading: boolean;
  statusFailed: boolean;
  authReconnect: boolean;
  connected: boolean;
}): SumitKind {
  if (input.forced === "loading") return "loading";
  if (input.forced === "error") return "error";
  if (input.noCompany) return "disconnected";
  if (input.statusLoading) return "loading";
  if (input.statusFailed) return "error";
  if (input.authReconnect) return "reconnect";
  if (input.connected) return "connected";
  return "disconnected";
}

/** Connections → onboarding, then back to Connections with the same connector's sheet open. */
export function onboardingFromSettings(search: string, sheet: "sumit" | "mercury"): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : "");
  params.set("return", `/settings/connections?sheet=${sheet}`);
  return `/onboarding?${params.toString()}`;
}

export const MERCURY_REFRESH_KEYS = ["mercury", "dashboard", "unpaid", "review", "project"];

/** A connector's one-word status (0082 §3). A read-only view can't reconnect, so an expired key
    reads neutral there, as the AI row does (FLOW-507): "לא מחובר כרגע" for a viewer, "לא מחובר"
    while writes are held. */
export function connectorWord(kind: SumitKind, readOnly = false, viewerCopy = false): string {
  if (kind === "reconnect") return readOnly ? (viewerCopy ? "לא מחובר כרגע" : "לא מחובר") : "צריך לחבר מחדש";
  if (kind === "connected") return "מחובר";
  return "לא מחובר";
}

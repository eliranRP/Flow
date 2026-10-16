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

/** Connections → onboarding, then back to that connector's page (FLOW-512). */
export function onboardingFromSettings(search: string, provider: "sumit" | "mercury"): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : "");
  params.set("return", `/settings/connections/${provider}`);
  return `/onboarding?${params.toString()}`;
}

export const MERCURY_REFRESH_KEYS = ["mercury", "dashboard", "unpaid", "review", "project"];

/** A connector's one-word status (FLOW-512, the board's words). A read-only view can't reconnect,
    so an expired key reads "לא מחובר" there. */
export function connectorWord(kind: SumitKind, readOnly = false): string {
  if (kind === "reconnect") return readOnly ? "לא מחובר" : "צריך חיבור";
  if (kind === "connected") return "מחובר";
  return "לא מחובר";
}

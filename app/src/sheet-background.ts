import type { Location } from "react-router-dom";

/** History state that keeps the page under a sheet. Closing pops back to it. */
export function withSheetBackground(location: Location) {
  return { backgroundLocation: location };
}

export function readSheetBackground(state: unknown): Location | undefined {
  if (typeof state !== "object" || state === null || !("backgroundLocation" in state)) {
    return undefined;
  }
  return isLocation(state.backgroundLocation) ? state.backgroundLocation : undefined;
}

function isLocation(value: unknown): value is Location {
  if (typeof value !== "object" || value === null) return false;
  if (!("pathname" in value) || typeof value.pathname !== "string") return false;
  if (!("search" in value) || typeof value.search !== "string") return false;
  if (!("hash" in value) || typeof value.hash !== "string") return false;
  if (!("key" in value) || typeof value.key !== "string") return false;
  return "state" in value;
}

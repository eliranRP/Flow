import type { Location } from "react-router-dom";

/** History state that keeps the page under a sheet. Closing pops back to it. */
export function withSheetBackground(location: Location) {
  return { backgroundLocation: location };
}

export function readSheetBackground(state: unknown): Location | undefined {
  if (typeof state !== "object" || state === null || !("backgroundLocation" in state)) {
    return undefined;
  }
  const value = state.backgroundLocation;
  if (typeof value !== "object" || value === null || !("pathname" in value)) return undefined;
  return value as Location;
}

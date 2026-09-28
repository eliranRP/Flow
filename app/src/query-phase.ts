import { onlineManager } from "@tanstack/react-query";
import type { HomePreview } from "./preview";
import type { ScreenPhase } from "./ui/screen-phase";

export type { ScreenPhase };

type QueryFlags = {
  isPending: boolean;
  isError: boolean;
  isPaused: boolean;
};

/**
 * Preview is decided before the live query. A disabled query is pending in
 * TanStack Query v5, and treating that as loading hides the preview states.
 */
export function screenPhase(preview: HomePreview, query?: QueryFlags): ScreenPhase {
  if (preview === "loading") return { kind: "loading" };
  if (preview === "error") return { kind: "error", offline: true };
  if (preview === "error-server") return { kind: "error", offline: false };
  if (preview !== "off") return { kind: "empty" };
  if (!query) return { kind: "ready" };
  const offline = query.isPaused || !onlineManager.isOnline();
  // A fetch that never starts while offline stays pending. That is a failure, not a skeleton.
  if (query.isPending && offline) return { kind: "error", offline: true };
  if (query.isPending) return { kind: "loading" };
  if (query.isError) return { kind: "error", offline };
  return { kind: "ready" };
}

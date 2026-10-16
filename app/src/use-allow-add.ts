import { usePreviewMode } from "./preview";
import { useCompanyRole, useHoldWrites, useIsViewer } from "./use-is-viewer";

/**
 * FLOW-364: whether this session shows the + (Home's band; the tab bar's + before). Preview keeps
 * it, unless this session is already a viewer. A role that is still loading hides it, so a viewer
 * never taps it, and an unknown role never shows a write control.
 */
export function useAllowAdd(): boolean {
  const role = useCompanyRole();
  const viewer = useIsViewer();
  const holdWrites = useHoldWrites();
  const preview = usePreviewMode();
  return role !== "unknown" && !viewer && (preview || !holdWrites);
}

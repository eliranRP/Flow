import { usePreviewMode } from "../preview";
import { useCompanyRole } from "../use-is-viewer";

/**
 * Setup follows the shared company role. A viewer, or a failed read with no
 * saved role, does not enter the run. An editor does not either (FLOW-601):
 * setup is the owner's connectors, Jev and install. A missing company is an
 * owner, so step 0 can create one.
 */
export function useSetupViewer(): { ready: boolean; viewer: boolean } {
  const preview = usePreviewMode();
  const role = useCompanyRole();
  if (preview) return { ready: true, viewer: false };
  if (role === "loading") return { ready: false, viewer: false };
  if (role === "viewer" || role === "editor" || role === "unknown") return { ready: true, viewer: true };
  return { ready: true, viewer: false };
}

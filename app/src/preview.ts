import { useSearchParams } from "react-router-dom";

export type HomePreview = "off" | "empty" | "loading" | "error" | "error-server";

/**
 * A preview query bypasses sign-in so a reviewer can open empty, loading, and
 * error chrome. It never supplies accounts, documents, or amounts. `demo` is
 * treated as empty: the books come from SUMIT through the ledger.
 */
export function useHomePreview(): HomePreview {
  const [params] = useSearchParams();
  const value = params.get("preview");
  if (value == null) return "off";
  if (value === "loading") return "loading";
  if (value === "error") return "error";
  if (value === "error-server") return "error-server";
  return "empty";
}

export function usePreviewMode(): boolean {
  return useHomePreview() !== "off";
}

/** Offline and server load previews draw no band. Home and the status bar share this. */
export function previewHidesBand(preview: HomePreview): boolean {
  return preview === "error" || preview === "error-server";
}

/** Keeps preview and a project filter. The dev review fixture also keeps its query flag. */
export function useFlowSearch(): string {
  const [params] = useSearchParams();
  const next = new URLSearchParams();
  const preview = params.get("preview");
  const project = params.get("project");
  if (preview) next.set("preview", preview);
  if (project) next.set("project", project);
  if (import.meta.env.DEV) {
    const e2e = params.get("e2e");
    if (e2e) next.set("e2e", e2e);
  }
  const value = next.toString();
  return value ? `?${value}` : "";
}

/** Keeps the current preview on a return path that does not already carry one. */
export function keepPreview(path: string, previewSearch: string): string {
  if (previewSearch === "" || path.includes("preview=")) return path;
  const query = previewSearch.startsWith("?") ? previewSearch.slice(1) : previewSearch;
  if (query === "") return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/** Keeps the current preview flag on in-app links. Empty when signed in for real. */
export function usePreviewSearch(): string {
  const [params] = useSearchParams();
  const value = params.get("preview");
  if (!value) return "";
  return `?preview=${encodeURIComponent(value)}`;
}

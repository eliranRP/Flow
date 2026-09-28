import { useSearchParams } from "react-router-dom";

export type HomePreview = "off" | "empty" | "loading" | "error" | "error-server";

/** Any `preview` query bypasses sign-in. `loading`, `error`, and `error-server` are review states. */
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

/** Keeps the current preview flag on in-app links. Empty when signed in for real. */
export function usePreviewSearch(): string {
  const [params] = useSearchParams();
  const value = params.get("preview");
  if (!value) return "";
  return `?preview=${encodeURIComponent(value)}`;
}

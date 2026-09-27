import { useSearchParams } from "react-router-dom";

export type HomePreview = "off" | "empty" | "loading" | "error";

/** Any `preview` query bypasses sign-in. `loading` and `error` are review states. */
export function useHomePreview(): HomePreview {
  const [params] = useSearchParams();
  const value = params.get("preview");
  if (value == null) return "off";
  if (value === "loading") return "loading";
  if (value === "error") return "error";
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

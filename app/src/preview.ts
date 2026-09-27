import { useSearchParams } from "react-router-dom";

/** `/?preview=1` shows the shell with sample-empty numbers and no sign-in. */
export function usePreviewMode(): boolean {
  const [params] = useSearchParams();
  return params.get("preview") === "1";
}

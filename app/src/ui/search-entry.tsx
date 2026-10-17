/** Location state the entry sets, so the search focuses its field on a fresh visit only. */
export const SEARCH_FOCUS_STATE = { focusSearch: true } as const;

export function wantsSearchFocus(state: unknown): boolean {
  return typeof state === "object" && state !== null && "focusSearch" in state && state.focusSearch === true;
}

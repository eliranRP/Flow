import { IconButton } from "./icon-button";
import { SearchIcon } from "./icons";

/** Location state the entry sets, so the search focuses its field on a fresh visit only. */
export const SEARCH_FOCUS_STATE = { focusSearch: true } as const;

export function wantsSearchFocus(state: unknown): boolean {
  return typeof state === "object" && state !== null && "focusSearch" in state && state.focusSearch === true;
}

/**
 * The search entry on Home's band and the Projects bar (FLOW-323, option A): a plain thin-stroke
 * outline magnifier in a 44px target, never a filled glyph or an emoji. It opens the transaction
 * search with the field focused. The magnifier is not mirrored in RTL (DESIGN-RULES 3.4).
 */
export function SearchEntry({ to, onBand = false }: { to: string; onBand?: boolean }) {
  return (
    <IconButton to={to} state={SEARCH_FOCUS_STATE} label="חיפוש תנועות" onBand={onBand} className="ui-search-entry">
      <SearchIcon size={24} stroke={1.6} />
    </IconButton>
  );
}

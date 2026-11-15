import type { ReactNode } from "react";
import { Button } from "./button";

type EmptyStateProps = {
  /** The tint circle with an outline icon. The board's empty states mostly have none (FLOW-371). */
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  /** Below the action: one quiet card, e.g. the evening reminder question (FLOW-502). */
  aside?: ReactNode;
};

/** Centred empty block: tint circle, title, one secondary line, at most one action. */
export function EmptyState({ icon, title, body, action, aside }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      {icon ? <div className="ui-empty-icon">{icon}</div> : null}
      <p className="ui-empty-title t-name" dir="rtl">{title}</p>
      <p className="ui-empty-line" dir="rtl">{body}</p>
      {action ? <div className="ui-empty-action">{action}</div> : null}
      {aside}
    </div>
  );
}

type FailureLineProps = {
  offline: boolean;
  onRetry: () => void;
  /** FLOW-1102: what did not load, when it is not the whole page ("לא הצלחנו לטעון את החודשים."). */
  message?: string;
};

/**
 * A failure is one line and the retry (FLOW-371, REDESIGN-BUILD: "a failure shows one line with
 * נסו שוב"). Offline names the connection and says nothing was deleted. The retry is the 44px link, not a block of its own.
 */
export function FailureLine({ offline, onRetry, message = "לא הצלחנו לטעון." }: FailureLineProps) {
  return (
    <div className="ui-failure" role="status">
      <span>{offline ? "אין חיבור לאינטרנט. שום דבר לא נמחק." : message}</span>
      <Button
        variant="link"
        onClick={() => {
          onRetry();
        }}
      >
        נסו שוב
      </Button>
    </div>
  );
}

/**
 * A search with no lines (FLOW-368 §2.6, FLOW-1049 V3-Search): the name searched, one muted line, and never a
 * dead end: with chips a link drops them; always the filters and a clear (back to the start's checks).
 */
export function SearchEmptyState({ text, withChips, onClearChips, onFilters, onClear }: {
  text: string;
  withChips: boolean;
  onClearChips?: () => void;
  /** Opens the filter sheet; a screen with no filters (Company profit) leaves it out, and so the button. */
  onFilters?: () => void;
  /** Clears the text and the filters: the start, with שווה לבדוק and the recent searches. */
  onClear: () => void;
}) {
  return (
    <div className="ui-search-empty">
      <h2 className="ui-search-empty-title">{text !== "" ? `לא מצאנו ״${text}״` : "אין תנועות שמתאימות לסינון"}</h2>
      <p className="ui-search-empty-body">
        {withChips
          ? "החיפוש הוא לפי ספק, לקוח, פרויקט, קטגוריה או סכום, בתוך הסינון שבחרתם."
          : "נסו שם אחר, פרויקט או סכום."}
      </p>
      <div className="ui-search-empty-actions">
        {withChips ? <Button variant="link" onClick={onClearChips}>חיפוש בלי הסינון</Button> : null}
        {onFilters == null ? null : <Button variant="secondary" onClick={onFilters}>סינון</Button>}
        <Button variant="link" onClick={onClear}>ניקוי החיפוש</Button>
      </div>
    </div>
  );
}

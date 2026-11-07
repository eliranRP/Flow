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

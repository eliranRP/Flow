import type { ReactNode } from "react";

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

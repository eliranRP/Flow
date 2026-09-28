import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
};

/** Centred empty block: tint circle, title, one secondary line, at most one action. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      <div className="ui-empty-icon">{icon}</div>
      <p className="ui-empty-title t-title-3" dir="rtl">{title}</p>
      <p className="ui-empty-line" dir="rtl">{body}</p>
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  );
}

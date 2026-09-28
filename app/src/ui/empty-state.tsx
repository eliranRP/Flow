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
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <p className="t-title-2">{title}</p>
      <p className="empty-line t-label text-text-secondary">{body}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-side py-section text-center">
      <div className="text-text-muted">{icon}</div>
      <h1 className="mt-4 text-title-3">{title}</h1>
      <p className="mt-2 max-w-xs text-hint text-text-secondary">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

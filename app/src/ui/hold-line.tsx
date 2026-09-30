import type { ReactNode } from "react";
import { TextLink } from "./text-link";

/** The hold sentence and ביטול השינוי. The change sheet and Split use this one line. */
export function HoldLine({ children, onDiscard }: { children: ReactNode; onDiscard: () => void }) {
  return (
    <div className="ui-hold-line" role="status">
      <p className="ui-hold-line-text t-hint">{children}</p>
      <TextLink tone="quiet" chevron={false} onClick={onDiscard}>ביטול השינוי</TextLink>
    </div>
  );
}

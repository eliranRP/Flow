import type { ReactNode } from "react";
import { Button } from "./button";

/** The hold sentence and ביטול השינוי. The change sheet and Split use this one line. */
export function HoldLine({ children, onDiscard }: { children: ReactNode; onDiscard: () => void }) {
  return (
    <div className="ui-hold-line">
      <p className="ui-hold-line-text t-hint" role="status">{children}</p>
      <Button variant="link" quiet onClick={onDiscard}>ביטול השינוי</Button>
    </div>
  );
}

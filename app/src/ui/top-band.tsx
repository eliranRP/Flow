import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

type TopBandProps = {
  children: ReactNode;
  trailing?: ReactNode;
  preview?: boolean;
};

/** Violet band. Home and the Project header only. */
export function TopBand({ children, trailing, preview = false }: TopBandProps) {
  return (
    <header className="ui-band">
      <div className="ui-band-row">
        <Wordmark tone="on-band" />
        {trailing}
      </div>
      {children}
      {preview ? <p className="ui-preview-banner t-hint">מצב תצוגה</p> : null}
    </header>
  );
}

import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

type TopBandProps = {
  children?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
  preview?: boolean;
  /** Project hides the wordmark. Home keeps it. */
  wordmark?: boolean;
};

/** Violet band. Home and the Project header only. */
export function TopBand({ children, trailing, leading, preview = false, wordmark = true }: TopBandProps) {
  return (
    <header className="ui-band">
      <div className="ui-band-row">
        {leading}
        {wordmark ? <Wordmark tone="on-band" /> : null}
        {trailing}
      </div>
      {children}
      {preview ? <p className="ui-preview-banner t-hint">מצב תצוגה</p> : null}
    </header>
  );
}

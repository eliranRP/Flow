import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

type TopBandProps = {
  children?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
  /** Sits above the wordmark row. Pull-to-refresh uses it for the spinner. */
  status?: ReactNode;
  /** Example tag sits on the band, not in a strip above it. */
  example?: ReactNode;
  preview?: boolean;
  /** Home and Project hide it. The default stays for the band chrome stories. */
  wordmark?: boolean;
};

/** Violet band. Home and the Project header only. */
export function TopBand({ children, trailing, leading, status, example, preview = false, wordmark = true }: TopBandProps) {
  return (
    <header className="ui-band">
      {status}
      <div className="ui-band-row">
        {leading}
        {wordmark ? <Wordmark tone="on-band" /> : null}
        {trailing}
      </div>
      {example ? <div className="ui-band-example">{example}</div> : null}
      {children}
      {preview ? <p className="ui-preview-banner t-hint">מצב תצוגה</p> : null}
    </header>
  );
}

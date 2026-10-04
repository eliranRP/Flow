import type { ReactNode, SubmitEvent } from "react";
import { FocusTitle } from "../ui/focus-title";
import { BackIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { ProgressBar } from "../ui/progress-bar";
import { TextLink } from "../ui/text-link";
import { SETUP_TOTAL } from "./copy";
import { DemoSlot } from "./demo-slot";
import type { SetupStepId } from "./model";

/** Template C for one setup step. Step 0 has no counter and no דלג. */
export function SetupStep({
  step,
  title,
  line,
  demoAlt,
  onBack,
  onSkip,
  onSubmit,
  primary,
  secondary,
  children,
}: {
  step: SetupStepId;
  title: string;
  line: ReactNode;
  demoAlt?: string;
  onBack?: () => void;
  onSkip?: () => void;
  onSubmit?: (event: SubmitEvent<HTMLFormElement>) => void;
  primary?: ReactNode;
  secondary?: ReactNode;
  children?: ReactNode;
}) {
  const counted = step >= 1;
  const body = (
    <>
      {onBack || onSkip ? (
        <div className="ui-setup-bar">
          {onBack ? (
            <IconButton label="חזרה" onClick={onBack}>
              <BackIcon />
            </IconButton>
          ) : (
            <span className="ui-setup-bar-slot" aria-hidden="true" />
          )}
          {onSkip ? (
            <TextLink className="ui-setup-skip" tone="accent" chevron={false} onClick={onSkip}>
              דלג
            </TextLink>
          ) : null}
        </div>
      ) : null}
      {counted ? (
        <div className="ui-setup-meter">
          <ProgressBar
            variant="thin"
            value={step}
            max={SETUP_TOTAL}
            label="התקדמות ההגדרה"
            caption={
              <span className="t-hint" aria-live="polite">
                שלב <bdi className="ui-num" dir="ltr">{String(step)}</bdi> מתוך <bdi className="ui-num" dir="ltr">{String(SETUP_TOTAL)}</bdi>
              </span>
            }
          />
        </div>
      ) : null}
      <div className="ui-setup-copy">
        <FocusTitle className="t-title-1">{title}</FocusTitle>
        <p className="ui-setup-line t-body">{line}</p>
      </div>
      {demoAlt ? <DemoSlot alt={demoAlt} /> : null}
      {children ? <div className="ui-setup-body">{children}</div> : null}
      {primary || secondary ? (
        <div className="ui-setup-cta">
          {primary}
          {secondary}
        </div>
      ) : null}
    </>
  );
  if (onSubmit) {
    return (
      <form className="ui-setup" data-setup-step={step} onSubmit={onSubmit}>
        {body}
      </form>
    );
  }
  return (
    <main className="ui-setup" data-setup-step={step}>
      {body}
    </main>
  );
}

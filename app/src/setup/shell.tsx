import { useState, type ReactNode } from "react";
import { FocusTitle } from "../ui/focus-title";
import { ProgressBar } from "../ui/progress-bar";
import { TextLink } from "../ui/text-link";
import { BACK, SETUP_TOTAL, SKIP_ALL } from "./copy";
import { SkipSheet } from "./skip-sheet";
import type { StepNumber } from "./model";

/**
 * OnboardingFrame (FLOW-514 §1): the page of every setup screen. Steps 1 to 7 get the top block
 * (הקודם, the counter, דילוג על הכל, the seven segments); welcome and done are full screens. The
 * body scrolls and the bottom holds the main button and the optional secondary one.
 */
export function OnboardingFrame({
  step,
  title,
  lead,
  onBack,
  onSkipAll,
  top,
  primary,
  secondary,
  children,
}: {
  step: StepNumber | "welcome" | "done";
  title: string;
  /** One line under the title. */
  lead?: ReactNode;
  /** הקודם. Step 1 has none: its slot keeps the space, invisible and inert. */
  onBack?: () => void;
  /** Runs when the skip sheet's confirm is tapped. Steps 1 to 7 and welcome have the sheet; done does not. */
  onSkipAll?: () => Promise<void> | void;
  /** Above the title (welcome's logo). */
  top?: ReactNode;
  primary: ReactNode;
  /** Either the node, or a function that gets the skip sheet's opener (welcome's "דילוג, אגדיר אחר כך"). */
  secondary?: ReactNode | ((openSkip: () => void) => ReactNode);
  children?: ReactNode;
}) {
  const [skipOpen, setSkipOpen] = useState(false);
  const counted = typeof step === "number";
  const full = !counted;
  return (
    <main className="ui-onb" data-setup-step={String(step)}>
      {counted && onSkipAll ? (
        <div className="ui-onb-top">
          <div className="ui-onb-row">
            {onBack ? (
              <TextLink className="ui-onb-link" tone="accent" chevron={false} onClick={onBack}>
                {BACK}
              </TextLink>
            ) : (
              <span className="ui-onb-link ui-onb-link-hidden" aria-hidden="true">{BACK}</span>
            )}
            <span className="t-hint ui-onb-counter" aria-live="polite">
              שלב <bdi dir="ltr">{String(step)}</bdi> מתוך <bdi dir="ltr">{String(SETUP_TOTAL)}</bdi>
            </span>
            <TextLink className="ui-onb-link" tone="accent" chevron={false} onClick={() => { setSkipOpen(true); }}>
              {SKIP_ALL}
            </TextLink>
          </div>
          <ProgressBar variant="steps" count={SETUP_TOTAL} current={step} label="התקדמות ההגדרה" />
        </div>
      ) : null}
      <div className={full ? "ui-onb-body ui-onb-body-full" : "ui-onb-body"}>
        <div className="ui-onb-enter" key={String(step)}>
          {top}
          <div className="ui-onb-copy">
            <FocusTitle className={full ? "t-title ui-onb-title" : "t-name ui-onb-title"}>{title}</FocusTitle>
            {lead ? <p className="t-line2 ui-onb-lead">{lead}</p> : null}
          </div>
          {children}
        </div>
      </div>
      <div className="ui-onb-foot">
        {primary}
        {typeof secondary === "function" ? secondary(() => { setSkipOpen(true); }) : secondary}
      </div>
      {onSkipAll ? <SkipSheet open={skipOpen} onOpenChange={setSkipOpen} onConfirm={onSkipAll} /> : null}
    </main>
  );
}

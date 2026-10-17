import { Button } from "../ui/button";
import { WELCOME_LATER, WELCOME_LEAD, WELCOME_NEXT, WELCOME_TITLE } from "./copy";
import { OnboardingFrame } from "./shell";

/** Welcome (FLOW-514): the logo, the title, one lead. Full screen, no progress. */
export function SetupWelcome({ onStart, onSkipAll }: { onStart: () => void; onSkipAll: () => Promise<void> | void }) {
  return (
    <OnboardingFrame
      step="welcome"
      title={WELCOME_TITLE}
      lead={WELCOME_LEAD}
      onSkipAll={onSkipAll}
      top={<span className="ui-onb-logo" aria-hidden="true">F</span>}
      primary={<Button type="button" full onClick={onStart}>{WELCOME_NEXT}</Button>}
      secondary={(openSkip) => (
        <Button type="button" variant="link" full onClick={openSkip}>{WELCOME_LATER}</Button>
      )}
    />
  );
}

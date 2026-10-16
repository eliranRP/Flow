import { Button } from "../ui/button";
import { WELCOME_LATER, WELCOME_LEAD, WELCOME_MOVIE_LABEL, WELCOME_NEXT, WELCOME_TITLE } from "./copy";
import { WELCOME_MOVIE } from "./movie-scenes";
import { SetupMovie } from "./movie";
import { OnboardingFrame } from "./shell";

/** Welcome (FLOW-514): the logo, the title, one lead, the movie. Full screen, no progress. */
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
    >
      <SetupMovie scenes={WELCOME_MOVIE.scenes} label={WELCOME_MOVIE_LABEL} />
    </OnboardingFrame>
  );
}

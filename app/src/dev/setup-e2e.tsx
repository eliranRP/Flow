import { useParams } from "react-router-dom";
import { SetupWelcome } from "../setup/welcome";
import { SkipSheet } from "../setup/skip-sheet";
import { StepConnect, type StepProps } from "../setup/steps";
import { StoryRoute } from "../ui/story-route";

/** Dev-only e2e fixtures for the onboarding proofs: the same components the Storybook stories draw, with invented data and no session. */
const noop: StepProps = {
  onDone: () => undefined,
  onStamp: () => undefined,
  onSkipStep: () => undefined,
  onSkipAll: () => undefined,
  onBack: () => undefined,
};

export function DevSetupFrame() {
  const { frame = "connect" } = useParams();
  if (frame === "welcome") {
    return <SetupWelcome onStart={() => undefined} onSkipAll={() => undefined} />;
  }
  if (frame === "skip") {
    return (
      <StoryRoute entry="/setup/2">
        <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
        <SkipSheet open onOpenChange={() => undefined} onConfirm={() => undefined} />
      </StoryRoute>
    );
  }
  return (
    <StoryRoute entry="/setup/2">
      <StepConnect {...noop} mercuryConnected={false} sumitConnected={false} />
    </StoryRoute>
  );
}

import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const OnboardingScreen = lazy(() => screenLoaders.onboarding().then((m) => ({ default: m.OnboardingScreen })));
const SetupIndex = lazy(() => screenLoaders.setupRoutes().then((m) => ({ default: m.SetupIndex })));
const SetupStepScreen = lazy(() => screenLoaders.setupRoutes().then((m) => ({ default: m.SetupStepScreen })));

/** First run: the onboarding screen and the setup steps. Both sit under the full-screen layout. */
export function SetupRoutes() {
  return (
    <>
      <Route path="onboarding" element={<OnboardingScreen />} />
      <Route path="setup" element={<SetupIndex />} />
      <Route path="setup/:step" element={<SetupStepScreen />} />
    </>
  );
}

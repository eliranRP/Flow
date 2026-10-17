import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const SetupIndex = lazy(() => screenLoaders.setupRoutes().then((m) => ({ default: m.SetupIndex })));
const SetupStepScreen = lazy(() => screenLoaders.setupRoutes().then((m) => ({ default: m.SetupStepScreen })));
const SetupWelcomeScreen = lazy(() => screenLoaders.setupRoutes().then((m) => ({ default: m.SetupWelcomeScreen })));
const SetupDoneScreen = lazy(() => screenLoaders.setupRoutes().then((m) => ({ default: m.SetupDoneScreen })));

/** First run: the setup steps. They sit under the full-screen layout. */
export function SetupRoutes() {
  return (
    <>
      <Route path="setup" element={<SetupIndex />} />
      <Route path="setup/welcome" element={<SetupWelcomeScreen />} />
      <Route path="setup/done" element={<SetupDoneScreen />} />
      <Route path="setup/:step" element={<SetupStepScreen />} />
    </>
  );
}

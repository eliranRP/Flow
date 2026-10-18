import { lazy } from "react";
import { InstallScreen, type InstallMode } from "../../ui/install-screen";
import { useGoBack } from "../../ui/back";
import { useToast } from "../../ui/toast";
import type { DevRoute } from "./types";

const DevSetupFrame = /* @__PURE__ */ lazy(() => import("../setup-e2e").then((m) => ({ default: m.DevSetupFrame })));

export function DevInstall({ mode }: { mode: InstallMode }) {
  const goBack = useGoBack();
  const toast = useToast();
  return (
    <InstallScreen
      mode={mode}
      onDismiss={() => {
        goBack("/settings?preview=1");
      }}
      onInstall={() => {
        toast.show({ message: "ההתקנה נפתחה" });
      }}
    />
  );
}

export const setupRoutes: DevRoute[] = [{ path: "setup/:frame", element: <DevSetupFrame /> }];

export const installRoutes: DevRoute[] = [
  { path: "install-android", element: <DevInstall mode="android-prompt" /> },
  { path: "install-other", element: <DevInstall mode="iphone-other" /> },
];

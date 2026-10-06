import type { ReactNode } from "react";
import {
  AndroidInstallDemo,
  FirstApprovalDemo,
  IosInstallDemo,
  JevSwitchDemo,
  ProjectsDemo,
  SumitConnectDemo,
} from "../ui/setup-demos";
import { setupHost } from "./copy";

/** Which demo fills the stage. Replacing one demo is this map. */
export type SetupDemoId = "sumit" | "jev" | "projects" | "approval" | "ios" | "android";

const DEMOS: Record<SetupDemoId, () => ReactNode> = {
  sumit: () => <SumitConnectDemo />,
  jev: () => <JevSwitchDemo />,
  projects: () => <ProjectsDemo />,
  approval: () => <FirstApprovalDemo />,
  ios: () => <IosInstallDemo />,
  android: () => <AndroidInstallDemo />,
};

/** The setup stage. The player owns the phone, the alt, and שוב. */
export function DemoSlot({ demo }: { demo: SetupDemoId }) {
  return (
    <div className="ui-setup-stage-host" data-demo-slot="" data-setup-host={setupHost()}>
      {DEMOS[demo]()}
    </div>
  );
}

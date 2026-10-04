import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect, type ReactNode } from "react";
import {
  AndroidInstallDemo,
  FirstApprovalDemo,
  IosInstallDemo,
  JevSwitchDemo,
  ProjectsDemo,
  SumitConnectDemo,
} from "./setup-demos";

function reducedMotionList(query: string): MediaQueryList {
  return {
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
    addListener: () => undefined,
    removeListener: () => undefined,
  };
}

let originalMatchMedia: typeof window.matchMedia | null = null;

function installReducedMotion() {
  if (originalMatchMedia) return;
  originalMatchMedia = window.matchMedia.bind(window);
  const previous = originalMatchMedia;
  window.matchMedia = (query: string) => {
    if (query.includes("prefers-reduced-motion")) return reducedMotionList(query);
    return previous(query);
  };
}

function uninstallReducedMotion() {
  if (!originalMatchMedia) return;
  window.matchMedia = originalMatchMedia;
  originalMatchMedia = null;
}

function ReducedMotionFrame({ children }: { children: ReactNode }) {
  installReducedMotion();
  useLayoutEffect(() => {
    return () => {
      uninstallReducedMotion();
    };
  }, []);
  return children;
}

const forceReducedMotion: Decorator = (Story) => (
  <ReducedMotionFrame>
    <Story />
  </ReducedMotionFrame>
);

const meta = {
  title: "Components/SetupDemos",
  component: SumitConnectDemo,
  decorators: [forceReducedMotion],
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "heading-order", enabled: false },
          { id: "page-has-heading-one", enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof SumitConnectDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sumit: Story = {};

export const Jev: Story = {
  render: () => <JevSwitchDemo />,
};

export const Projects: Story = {
  render: () => <ProjectsDemo />,
};

export const Approval: Story = {
  render: () => <FirstApprovalDemo />,
};

export const IosInstall: Story = {
  render: () => <IosInstallDemo />,
};

export const AndroidInstall: Story = {
  render: () => <AndroidInstallDemo />,
};

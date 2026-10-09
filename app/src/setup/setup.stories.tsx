import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { TagIcon } from "../ui/icons";
import { longHebrew } from "../ui/story-support";
import { SetupCard } from "./card";
import { JEV_HINT } from "./copy";
import { SetupStep } from "./shell";
import { StepBusiness, StepInstall, StepSumit } from "./steps";
import { StoryRoute } from "../ui/story-route";

const meta = {
  title: "Screens/Setup",
  component: SetupStep,
} satisfies Meta<typeof SetupStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SmartTag: Story = {
  args: {
    step: 2,
    title: "תיוג חכם",
    line: "Flow יציע פרויקט וקטגוריה לכל תנועה.",
    demo: "jev",
  },
  render: (args) => (
    <SetupStep
      {...args}
      onBack={() => undefined}
      onSkip={() => undefined}
      primary={<Button type="button" full>המשך</Button>}
    >
      <Toggle
        icon={<TagIcon size={24} />}
        label="תיוג חכם (Jev)"
        hint={`${JEV_HINT} ${longHebrew}`}
        checked
        onChange={() => undefined}
      />
    </SetupStep>
  ),
};

export const HomeCard: Story = {
  args: SmartTag.args,
  render: () => <SetupCard done={4} steps={[5]} onDismiss={() => undefined} />,
};

/** FLOW-606: a pasted tab is refused on the field, as create_company refuses it. */
const businessNameError = {
  args: SmartTag.args,
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/0">
      <StepBusiness userId={null} onDone={() => undefined} initialName={"סטודיו אלפא\tלעיצוב"} />
    </StoryRoute>
  ),
};

export const BusinessNameError: Story = { ...businessNameError, name: "Business step, name error" };
export const BusinessNameErrorDark: Story = {
  ...businessNameError,
  name: "Business step, name error, dark",
  globals: { theme: "dark" },
};
export const BusinessNameError320: Story = {
  ...businessNameError,
  name: "Business step, name error, 320",
  parameters: { flowRouter: false, viewport: { defaultViewport: "flow320" } },
};

/** FLOW-503: SUMIT and Mercury side by side on step 1, each opening its shared connect sheet. */
const connectStep = {
  args: SmartTag.args,
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/1">
      <StepSumit onBack={() => undefined} onSkip={() => undefined} onConnected={() => undefined} />
    </StoryRoute>
  ),
};

export const ConnectStep: Story = { ...connectStep, name: "Connect step, SUMIT or Mercury" };
export const ConnectStep320: Story = {
  ...connectStep,
  name: "Connect step, SUMIT or Mercury, 320",
  parameters: { flowRouter: false, viewport: { defaultViewport: "flow320" } },
};

/** FLOW-506: step 5 draws the install screen's numbered steps. */
const installStep = (mode: "iphone" | "android-steps") => ({
  args: SmartTag.args,
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/5">
      <StepInstall initialMode={mode} onBack={() => undefined} onSkip={() => undefined} onFinish={() => undefined} />
    </StoryRoute>
  ),
});

export const InstallStepIphone: Story = { ...installStep("iphone"), name: "Install step, iPhone" };
export const InstallStepAndroid: Story = { ...installStep("android-steps"), name: "Install step, Android steps" };
export const InstallStepIphoneDark: Story = { ...installStep("iphone"), name: "Install step, iPhone, dark", globals: { theme: "dark" } };
export const InstallStepIphone320: Story = {
  ...installStep("iphone"),
  name: "Install step, iPhone, 320",
  parameters: { flowRouter: false, viewport: { defaultViewport: "flow320" } },
};

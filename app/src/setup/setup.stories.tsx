import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { TagIcon } from "../ui/icons";
import { longHebrew } from "../ui/story-support";
import { SetupCard } from "./card";
import { JEV_HINT, STEP_TITLE } from "./copy";
import { SetupStep } from "./shell";
import { StepBusiness, StepInstall, StepStarter, StepSumit, SumitFailureNote } from "./steps";
import { StoryRoute } from "../ui/story-route";
import { NO_PREFS } from "../push";

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

/** FLOW-406: the starter pick right after the company step, כללי picked on arrival. */
const starterStep = {
  args: SmartTag.args,
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/0">
      <StepStarter onDone={() => undefined} />
    </StoryRoute>
  ),
};

export const StarterStep: Story = { ...starterStep, name: "Starter categories" };

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

/** FLOW-506: a failed SUMIT connect leaves the note under the demo, at the demo frame's inset. */
const connectFailed = {
  args: SmartTag.args,
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/1">
      <SetupStep
        step={1}
        title={STEP_TITLE[1] ?? ""}
        line="ההכנסות וההוצאות נכנסות לבד."
        demo="sumit"
        onBack={() => undefined}
        onSkip={() => undefined}
        primary={<Button type="button" full>ניסיון חוזר</Button>}
        secondary={<Button type="button" variant="secondary" full>חיבור Mercury</Button>}
      >
        <SumitFailureNote />
      </SetupStep>
    </StoryRoute>
  ),
};

export const ConnectFailed: Story = { ...connectFailed, name: "Connect step, SUMIT failed" };

/** FLOW-506: step 5 draws the install screen's numbered steps. */
const installStep = (mode: "iphone" | "android-steps", reminder = false) => ({
  args: SmartTag.args,
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/setup/5">
      <StepInstall
        initialMode={mode}
        // An answered sample hides the card without a server read (a story never fetches).
        pushSample={{ prefs: reminder ? NO_PREFS : { ...NO_PREFS, prompt_answered: true }, support: "ok" }}
        onBack={() => undefined}
        onSkip={() => undefined}
        onFinish={() => undefined}
      />
    </StoryRoute>
  ),
});

export const InstallStepAndroid: Story = { ...installStep("android-steps"), name: "Install step, Android steps" };


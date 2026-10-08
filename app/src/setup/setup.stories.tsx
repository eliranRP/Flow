import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { TagIcon } from "../ui/icons";
import { longHebrew } from "../ui/story-support";
import { SetupCard } from "./card";
import { JEV_HINT } from "./copy";
import { SetupStep } from "./shell";
import { StepBusiness } from "./steps";
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
  parameters: { ...businessNameError.parameters, viewport: { defaultViewport: "flow320" } },
};
